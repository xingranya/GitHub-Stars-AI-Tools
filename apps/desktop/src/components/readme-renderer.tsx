import { isValidElement, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

type ReadmeRendererProps = {
  markdown: string;
  repositoryFullName: string;
  sourcePath: string;
  className?: string;
};

export function ReadmeRenderer(props: ReadmeRendererProps) {
  const sourceDirectory = props.sourcePath.includes('/')
    ? props.sourcePath.split('/').slice(0, -1).join('/')
    : '';
  const className = props.className
    ?? 'readme-rendered min-w-0 rounded-lg border border-outline-variant/20 bg-surface-container-lowest/70 p-4 text-on-surface';
  const headingSlugCounts = new Map<string, number>();
  const components: Components = {
    h1: createHeadingComponent('h1', headingSlugCounts),
    h2: createHeadingComponent('h2', headingSlugCounts),
    h3: createHeadingComponent('h3', headingSlugCounts),
    h4: createHeadingComponent('h4', headingSlugCounts),
    h5: createHeadingComponent('h5', headingSlugCounts),
    h6: createHeadingComponent('h6', headingSlugCounts),
    a({ href, children, node: _node, ...anchorProps }) {
      const resolvedHref = resolveReadmeAssetUrl(
        href,
        props.repositoryFullName,
        sourceDirectory,
        'link',
      );
      if (!resolvedHref) {
        return <span {...anchorProps}>{children}</span>;
      }
      if (resolvedHref.startsWith('#')) {
        return (
          <a
            href={resolvedHref}
            {...anchorProps}
            onClick={(event) => handleReadmeHashClick(event, resolvedHref)}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={resolvedHref} target="_blank" rel="noreferrer" {...anchorProps}>
          {children}
        </a>
      );
    },
    img({ src, alt, node: _node, ...imageProps }) {
      const resolvedSrc = resolveReadmeAssetUrl(
        src,
        props.repositoryFullName,
        sourceDirectory,
        'image',
      );
      if (!resolvedSrc) {
        return null;
      }
      return <img src={resolvedSrc} alt={alt ?? ''} loading="lazy" {...imageProps} />;
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {props.markdown}
      </ReactMarkdown>
    </div>
  );
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

function createHeadingComponent(tag: HeadingTag, slugCounts: Map<string, number>) {
  return function ReadmeHeading({
    children,
    node: _node,
    ...headingProps
  }: ComponentPropsWithoutRef<HeadingTag> & { node?: unknown }) {
    const Tag = tag;
    const id = getUniqueHeadingId(children, slugCounts);
    return (
      <Tag id={id} {...headingProps}>
        {children}
      </Tag>
    );
  };
}

function getUniqueHeadingId(children: ReactNode, slugCounts: Map<string, number>) {
  const baseSlug = createGithubHeadingSlug(extractPlainText(children)) || 'section';
  const currentCount = slugCounts.get(baseSlug) ?? 0;
  slugCounts.set(baseSlug, currentCount + 1);
  return currentCount === 0 ? baseSlug : `${baseSlug}-${currentCount}`;
}

function createGithubHeadingSlug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractPlainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractPlainText(node.props.children);
  }
  return '';
}

function handleReadmeHashClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const targetId = safeDecodeUri(href.slice(1));
  if (!targetId) {
    return;
  }

  const readmeRoot = event.currentTarget.closest('.readme-rendered');
  const target = readmeRoot ? findElementById(readmeRoot, targetId) : null;
  if (!target) {
    return;
  }

  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function findElementById(root: Element, id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  }

  return Array.from(root.querySelectorAll<HTMLElement>('[id]')).find((element) => element.id === id) ?? null;
}

function resolveReadmeAssetUrl(
  url: string | undefined,
  repositoryFullName: string,
  sourceDirectory: string,
  mode: 'link' | 'image',
) {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) {
    return undefined;
  }

  if (trimmedUrl.startsWith('#')) {
    return mode === 'link' ? trimmedUrl : undefined;
  }

  if (trimmedUrl.startsWith('//')) {
    return `https:${trimmedUrl}`;
  }

  const scheme = trimmedUrl.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === 'http' || scheme === 'https') {
      return trimmedUrl;
    }
    if (mode === 'link' && scheme === 'mailto') {
      return trimmedUrl;
    }
    return undefined;
  }

  const normalizedPath = normalizeReadmePath(trimmedUrl, sourceDirectory);
  if (mode === 'image') {
    return `https://raw.githubusercontent.com/${repositoryFullName}/HEAD/${normalizedPath}`;
  }

  return `https://github.com/${repositoryFullName}/blob/HEAD/${normalizedPath}`;
}

function normalizeReadmePath(path: string, sourceDirectory: string) {
  const decodedPath = safeDecodeUri(path).trim();
  const suffixMatch = decodedPath.match(/[?#]/);
  const suffixIndex = suffixMatch?.index ?? decodedPath.length;
  const pathWithoutSuffix = decodedPath.slice(0, suffixIndex);
  const suffix = decodedPath.slice(suffixIndex);
  const cleanPath = pathWithoutSuffix.replace(/^\.\//, '');
  const isRepositoryRootPath = cleanPath.startsWith('/');
  const segments = isRepositoryRootPath
    ? []
    : sourceDirectory.split('/').filter(Boolean);

  for (const segment of cleanPath.replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `${segments.map(encodeURIComponent).join('/')}${suffix}`;
}

function safeDecodeUri(path: string) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
