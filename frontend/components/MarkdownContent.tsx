import { Fragment, ReactNode } from 'react';

function safeHref(value: string) {
  const href = value.trim();
  if (/^(https?:|mailto:)/i.test(href) || /^(\/|#|\.\/|\.\.\/)/.test(href)) return href;
  return null;
}

function inlineMarkdown(text: string): ReactNode[] {
  const tokenPattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*(.+?)\*|_([^_]+)_)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (match[2] && match[3]) {
      const href = safeHref(match[3]);
      nodes.push(
        href
          ? <a href={href} key={key++} rel="noreferrer" target="_blank">{match[2]}</a>
          : <Fragment key={key++}>{match[2]}</Fragment>,
      );
    } else if (match[4] || match[5]) {
      nodes.push(<strong key={key++}>{match[4] || match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<del key={key++}>{match[6]}</del>);
    } else if (match[7]) {
      nodes.push(<code key={key++}>{match[7]}</code>);
    } else if (match[8] || match[9]) {
      nodes.push(<em key={key++}>{match[8] || match[9]}</em>);
    }
    lastIndex = tokenPattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^\s*([-*_]\s*){3,}$/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    (line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]) &&
      lines[index + 1].includes('-'))
  );
}

export function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={blocks.length}>
          <code className={fence[1] ? `language-${fence[1]}` : undefined}>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const children = inlineMarkdown(heading[2]);
      if (level === 1) blocks.push(<h1 key={blocks.length}>{children}</h1>);
      else if (level === 2) blocks.push(<h2 key={blocks.length}>{children}</h2>);
      else if (level === 3) blocks.push(<h3 key={blocks.length}>{children}</h3>);
      else if (level === 4) blocks.push(<h4 key={blocks.length}>{children}</h4>);
      else if (level === 5) blocks.push(<h5 key={blocks.length}>{children}</h5>);
      else blocks.push(<h6 key={blocks.length}>{children}</h6>);
      index += 1;
      continue;
    }

    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      blocks.push(<hr key={blocks.length} />);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={blocks.length}><p>{inlineMarkdown(quote.join(' '))}</p></blockquote>);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>);
      blocks.push(ordered ? <ol key={blocks.length}>{children}</ol> : <ul key={blocks.length}>{children}</ul>);
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]) &&
      lines[index + 1].includes('-')
    ) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="markdown-table-wrap" key={blocks.length}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => <td key={cellIndex}>{inlineMarkdown(row[cellIndex] || '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={blocks.length}>
        {paragraph.map((part, partIndex) => (
          <Fragment key={partIndex}>
            {partIndex > 0 && <br />}
            {inlineMarkdown(part)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="markdown-content">{blocks}</div>;
}
