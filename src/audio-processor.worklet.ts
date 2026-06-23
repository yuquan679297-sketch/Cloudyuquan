// AudioWorklet processor — resamples mic input to 16kHz mono PCM and emits 200ms chunks.

interface VoiceHubProcessorOptions {
  processorOptions?: {
    inputSampleRate?: number;
    outputSampleRate?: number;
    chunkSize?: number;
  };
}

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: VoiceHubProcessorOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

class VoiceHubAudioProcessor extends AudioWorkletProcessor {
  private readonly inputSampleRate: number;
  private readonly outputSampleRate: number;
  private readonly chunkSize: number;
  private readonly sourceSamples: number[] = [];
  private readonly outputSamples: number[] = [];
  private readIndex = 0;

  constructor(options?: VoiceHubProcessorOptions) {
    super(options);
    this.inputSampleRate = options?.processorOptions?.inputSampleRate ?? 48000;
    this.outputSampleRate = options?.processorOptions?.outputSampleRate ?? 16000;
    this.chunkSize = options?.processorOptions?.chunkSize ?? 3200;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) {
      return true;
    }

    for (let index = 0; index < input.length; index += 1) {
      this.sourceSamples.push(input[index]);
    }

    this.resample();
    this.flushChunks();
    return true;
  }

  private resample() {
    const ratio = this.inputSampleRate / this.outputSampleRate;

    while (this.readIndex + 1 < this.sourceSamples.length) {
      const leftIndex = Math.floor(this.readIndex);
      const rightIndex = leftIndex + 1;
      const fraction = this.readIndex - leftIndex;
      const left = this.sourceSamples[leftIndex];
      const right = this.sourceSamples[rightIndex];
      this.outputSamples.push(left + (right - left) * fraction);
      this.readIndex += ratio;
    }

    const consumed = Math.floor(this.readIndex);
    if (consumed > 0) {
      this.sourceSamples.splice(0, consumed);
      this.readIndex -= consumed;
    }
  }

  private flushChunks() {
    while (this.outputSamples.length >= this.chunkSize) {
      const pcm = new Int16Array(this.chunkSize);

      for (let index = 0; index < this.chunkSize; index += 1) {
        const sample = Math.max(-1, Math.min(1, this.outputSamples[index]));
        pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
      }

      this.outputSamples.splice(0, this.chunkSize);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
  }
}

registerProcessor('voicehub-audio-processor', VoiceHubAudioProcessor);
