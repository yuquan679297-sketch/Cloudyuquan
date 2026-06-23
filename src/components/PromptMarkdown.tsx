import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PromptMarkdownProps {
  content: string;
}

export function PromptMarkdown({ content }: PromptMarkdownProps) {
  return (
    <div className="prompt-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          code({ className, children }) {
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
            const grammar = language ? Prism.languages[language] : undefined;

            if (!language || !grammar) {
              return <code className={className}>{children}</code>;
            }

            const highlighted = Prism.highlight(
              String(children).replace(/\n$/, ''),
              grammar,
              language,
            );

            return (
              <code
                className={`${className ?? ''} prism-code`}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
