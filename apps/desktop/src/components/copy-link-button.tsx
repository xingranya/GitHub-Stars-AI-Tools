import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';

type CopyStatus = 'idle' | 'copied' | 'error';

/** 复制仓库链接，并在按钮内反馈复制结果。 */
export function CopyLinkButton(props: { url: string; compact?: boolean; className?: string }) {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setStatus('idle');
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, [props.url]);

  async function handleCopy() {
    try {
      await copyText(props.url);
      setStatus('copied');
    } catch {
      setStatus('error');
    }

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = window.setTimeout(() => setStatus('idle'), 1800);
  }

  const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败' : props.compact ? '复制链接' : '复制仓库链接';
  const icon = status === 'copied' ? 'done' : status === 'error' ? 'error' : 'content_copy';

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-outline-variant/35 bg-surface-container-low px-2.5 text-xs font-medium leading-none text-on-surface transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${props.compact ? 'min-w-[78px]' : 'min-w-[112px]'} ${props.className ?? ''}`}
      title="复制仓库链接"
      aria-label={`复制仓库链接：${props.url}`}
    >
      <Icon name={icon} size={15} className="leading-none" />
      <span aria-live="polite">{label}</span>
    </button>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('剪贴板不可用');
  }
}
