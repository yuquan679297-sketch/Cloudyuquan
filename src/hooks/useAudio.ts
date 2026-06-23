// useAudio — captures microphone audio, streams 16kHz PCM chunks to Rust, and tracks recording state.

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingState, TranscriptResult, VADEvent } from '../types';
import { normalizeAudioRms } from '../uiWorkflow.js';

const WS_URL = 'ws://127.0.0.1:8765';
const OUTPUT_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 3200;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 500;

interface PcmReadyEvent {
  pcmBase64: string;
  byteLength: number;
}

interface AsrPartialEvent {
  text: string;
  pass: 'first';
}

interface AsrFinalEvent {
  text: string;
  pass: 'second';
  cer_estimate: number;
  confidence?: number;
}

interface AsrLivePreviewEvent {
  text: string;
  pass: 'start' | 'first' | 'second';
  isFinal: boolean;
}

interface AsrErrorEvent {
  message: string;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function floatToPcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return pcm.buffer;
}

function resampleTo16k(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate === OUTPUT_SAMPLE_RATE) {
    return input.slice();
  }

  const ratio = inputSampleRate / OUTPUT_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourceIndex - leftIndex;
    output[index] = input[leftIndex] + (input[rightIndex] - input[leftIndex]) * fraction;
  }

  return output;
}

async function connectWebSocket() {
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(WS_URL);
        socket.binaryType = 'arraybuffer';

        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error('WebSocket connection timed out'));
        }, 3000);

        socket.onopen = () => {
          window.clearTimeout(timeout);
          resolve(socket);
        };
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error(`WebSocket connection failed on attempt ${attempt}`));
        };
      });
    } catch (error) {
      if (attempt === RETRY_COUNT) {
        throw error;
      }
      await delay(RETRY_DELAY_MS);
    }
  }

  throw new Error('WebSocket connection failed');
}

interface UseAudioOptions {
  onFinalTranscript?: (text: string) => void | Promise<void>;
  onRecordingStart?: () => void;
  stopOnSilence?: boolean;
}

export function useAudio(options: UseAudioOptions = {}) {
  const [state, setState] = useState<RecordingState>('idle');
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [partialText, setPartialText] = useState('');
  const [livePreviewText, setLivePreviewText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stateRef = useRef<RecordingState>('idle');
  const partialTextRef = useRef('');
  const finalTextRef = useRef('');
  const onFinalTranscriptRef = useRef<UseAudioOptions['onFinalTranscript']>(options.onFinalTranscript);
  const onRecordingStartRef = useRef<UseAudioOptions['onRecordingStart']>(options.onRecordingStart);
  const stopOnSilenceRef = useRef(options.stopOnSilence ?? true);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const fallbackSamplesRef = useRef<number[]>([]);
  const levelAnimationRef = useRef<number | null>(null);
  const lastLevelUpdateRef = useRef(0);
  const audioLevelRef = useRef(0);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  const setRecordingState = useCallback((nextState: RecordingState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const sendChunk = useCallback((chunk: ArrayBuffer) => {
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(chunk);
    }
  }, []);

  const sendFallbackSamples = useCallback((samples: Float32Array) => {
    fallbackSamplesRef.current.push(...samples);

    while (fallbackSamplesRef.current.length >= CHUNK_SAMPLES) {
      const chunk = fallbackSamplesRef.current.splice(0, CHUNK_SAMPLES);
      sendChunk(floatToPcm16(new Float32Array(chunk)));
    }
  }, [sendChunk]);

  const cleanupAudio = useCallback(async () => {
    if (levelAnimationRef.current !== null) {
      window.cancelAnimationFrame(levelAnimationRef.current);
    }
    workletRef.current?.disconnect();
    scriptRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      await audioContextRef.current.close();
    }

    workletRef.current = null;
    scriptRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    fallbackSamplesRef.current = [];
    levelAnimationRef.current = null;
    lastLevelUpdateRef.current = 0;
    audioLevelRef.current = 0;
    setAudioLevel(0);
  }, []);

  const startLevelMonitoring = useCallback((analyser: AnalyserNode) => {
    const samples = new Float32Array(analyser.fftSize);

    const updateLevel = (timestamp: number) => {
      if (timestamp - lastLevelUpdateRef.current >= 75) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;

        for (let index = 0; index < samples.length; index += 1) {
          sumSquares += samples[index] * samples[index];
        }

        const nextLevel = normalizeAudioRms(Math.sqrt(sumSquares / samples.length));
        if (Math.abs(nextLevel - audioLevelRef.current) >= 0.015) {
          audioLevelRef.current = nextLevel;
          setAudioLevel(nextLevel);
        }
        lastLevelUpdateRef.current = timestamp;
      }

      levelAnimationRef.current = window.requestAnimationFrame(updateLevel);
    };

    levelAnimationRef.current = window.requestAnimationFrame(updateLevel);
  }, []);

  const startScriptProcessorFallback = useCallback((
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
  ) => {
    const script = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    script.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      sendFallbackSamples(resampleTo16k(input, audioContext.sampleRate));
    };

    source.connect(script);
    script.connect(silentGain);
    silentGain.connect(audioContext.destination);
    scriptRef.current = script;
    silentGainRef.current = silentGain;
  }, [sendFallbackSamples]);

  const startRecording = useCallback(async () => {
    if (stateRef.current === 'recording' || stateRef.current === 'processing') {
      return;
    }

    try {
      onRecordingStartRef.current?.();
      setErrorMessage(null);
      setPartialText('');
      setLivePreviewText('');
      partialTextRef.current = '';
      finalTextRef.current = '';
      setTranscript(null);
      await invoke<string>('init');
      wsRef.current = await connectWebSocket();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: OUTPUT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = analyser;
      startLevelMonitoring(analyser);

      try {
        await audioContext.audioWorklet.addModule(
          new URL('../audio-processor.worklet.ts', import.meta.url),
        );
        const worklet = new AudioWorkletNode(audioContext, 'voicehub-audio-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            inputSampleRate: audioContext.sampleRate,
            outputSampleRate: OUTPUT_SAMPLE_RATE,
            chunkSize: CHUNK_SAMPLES,
          },
        });
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (event.data instanceof ArrayBuffer) {
            sendChunk(event.data);
          }
        };

        source.connect(worklet);
        worklet.connect(silentGain);
        silentGain.connect(audioContext.destination);
        workletRef.current = worklet;
        silentGainRef.current = silentGain;
      } catch {
        startScriptProcessorFallback(audioContext, source);
      }

      setRecordingState('recording');
    } catch (error) {
      await cleanupAudio();
      wsRef.current?.close();
      wsRef.current = null;
      setErrorMessage(error instanceof Error ? error.message : 'Microphone setup failed');
      setRecordingState('error');
    }
  }, [cleanupAudio, sendChunk, setRecordingState, startLevelMonitoring, startScriptProcessorFallback]);

  const stopRecording = useCallback(async () => {
    if (stateRef.current !== 'recording') {
      return;
    }

    setRecordingState('processing');
    await cleanupAudio();

    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send('END_OF_STREAM');
      socket.close(1000, 'recording complete');
    }
    wsRef.current = null;
  }, [cleanupAudio, setRecordingState]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    onFinalTranscriptRef.current = options.onFinalTranscript;
  }, [options.onFinalTranscript]);

  useEffect(() => {
    onRecordingStartRef.current = options.onRecordingStart;
  }, [options.onRecordingStart]);

  useEffect(() => {
    stopOnSilenceRef.current = options.stopOnSilence ?? true;
  }, [options.stopOnSilence]);

  useEffect(() => {
    let pcmUnlisten: UnlistenFn | null = null;
    let vadUnlisten: UnlistenFn | null = null;
    let partialUnlisten: UnlistenFn | null = null;
    let livePreviewUnlisten: UnlistenFn | null = null;
    let finalUnlisten: UnlistenFn | null = null;
    let completeUnlisten: UnlistenFn | null = null;
    let fallbackUnlisten: UnlistenFn | null = null;
    let errorUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<PcmReadyEvent>('asr://pcm-ready', (event) => {
      setTranscript({
        raw: `${event.payload.byteLength} bytes PCM captured`,
        cleaned: '',
        refined: '',
        confidence: event.payload.pcmBase64.length > 0 ? 1 : 0,
      });
      setRecordingState('processing');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        pcmUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for PCM events');
      setRecordingState('error');
    });

    listen<AsrPartialEvent>('asr://partial', (event) => {
      setPartialText(event.payload.text);
      partialTextRef.current = event.payload.text;
      setTranscript((current) => ({
        raw: event.payload.text,
        cleaned: current?.cleaned ?? '',
        refined: current?.refined ?? '',
        confidence: current?.confidence,
      }));
      setRecordingState('processing');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        partialUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR partial events');
      setRecordingState('error');
    });

    listen<AsrLivePreviewEvent>('asr://live-preview', (event) => {
      setLivePreviewText(event.payload.text);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        livePreviewUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR live preview events');
      setRecordingState('error');
    });

    listen<AsrFinalEvent>('asr://final', (event) => {
      finalTextRef.current = event.payload.text;
      setTranscript((current) => ({
        raw: event.payload.text,
        cleaned: event.payload.text,
        refined: current?.refined ?? '',
        confidence: event.payload.confidence ?? current?.confidence,
      }));
      setRecordingState('processing');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        finalUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR final events');
      setRecordingState('error');
    });

    listen('asr://complete', () => {
      const finalText = finalTextRef.current || partialTextRef.current;
      if (finalText) {
        void onFinalTranscriptRef.current?.(finalText);
      }
      setRecordingState('done');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        completeUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR complete events');
      setRecordingState('error');
    });

    listen<AsrErrorEvent>('asr://fallback', (event) => {
      setErrorMessage(event.payload.message || 'offline mode');
      setRecordingState('error');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        fallbackUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR fallback events');
      setRecordingState('error');
    });

    listen<AsrErrorEvent>('asr://error', (event) => {
      setErrorMessage(event.payload.message);
      setRecordingState('error');
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        errorUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for ASR error events');
      setRecordingState('error');
    });

    listen<VADEvent>('asr://vad-silence', (event) => {
      if (stopOnSilenceRef.current && event.payload.type === 'silence' && stateRef.current === 'recording') {
        void stopRecordingRef.current();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        vadUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to listen for VAD events');
      setRecordingState('error');
    });

    return () => {
      cancelled = true;
      pcmUnlisten?.();
      vadUnlisten?.();
      partialUnlisten?.();
      livePreviewUnlisten?.();
      finalUnlisten?.();
      completeUnlisten?.();
      fallbackUnlisten?.();
      errorUnlisten?.();
      void cleanupAudio();
      wsRef.current?.close();
    };
  }, [cleanupAudio, setRecordingState]);

  return {
    state,
    transcript,
    livePreviewText,
    audioLevel,
    errorMessage,
    startRecording,
    stopRecording,
  };
}
