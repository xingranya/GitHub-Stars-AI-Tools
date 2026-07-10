import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { compactNumber, formatDate } from '@/lib/format';
import type { GithubRepositoryRecommendation } from '@/types';

export type DiscoveryCandidateAction = 'star' | 'mark' | 'ignore' | 'restore';
type CandidateStatus = 'new' | 'marked' | 'ignored' | 'starred';
const CATEGORY_LABELS: Record<string, string> = {
  'ai-agent': 'AI 与 Agent',
  desktop: '桌面应用',
  web: 'Web 与前端',
  backend: '后端与 API',
  data: '数据与数据库',
  devops: 'DevOps 与基础设施',
  'developer-tools': '开发工具',
  learning: '学习与文档',
  other: '其他',
};

export function RecommendationList(props: {
  repositories: GithubRepositoryRecommendation[];
  pendingActions: Record<string, DiscoveryCandidateAction>;
  candidateErrors: Record<string, string>;
  selectedFullName: string | null;
  onOpenDetails: (repository: GithubRepositoryRecommendation) => void;
  onStar: (repository: GithubRepositoryRecommendation) => Promise<void>;
  onUpdateStatus: (repository: GithubRepositoryRecommendation, status: 'new' | 'marked' | 'ignored') => Promise<void>;
}) {
  return (
    <div className="min-w-0" aria-label="推荐候选列表">
      {props.repositories.map((repository) => {
        const status = repository.candidateStatus ?? 'new';
        const pendingAction = props.pendingActions[repository.fullName];
        const error = props.candidateErrors[repository.fullName];
        const isPending = Boolean(pendingAction);
        const activityDate = repository.pushedAt ?? repository.candidateUpdatedAt;

        return (
          <article
            key={repository.fullName}
            className={`group border-b border-outline-variant/20 px-4 py-4 transition-colors duration-150 last:border-b-0 sm:px-5 ${props.selectedFullName === repository.fullName ? 'bg-primary/5' : 'hover:bg-surface-container-low'}`}
            aria-busy={isPending}
          >
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onOpenDetails(repository)}
                    className="min-w-0 truncate text-[15px] font-semibold text-on-surface underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    {repository.fullName}
                  </button>
                  <StatusBadge status={status} />
                  {repository.candidateCategory ? (
                    <span className="inline-flex rounded-md bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
                      {CATEGORY_LABELS[repository.candidateCategory] ?? '其他'}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-on-surface-variant">
                  {repository.description ?? '该仓库暂未提供项目描述。'}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-on-surface-variant">
                  <span className="inline-flex items-center gap-1.5 font-medium text-on-surface">
                    <Icon name="code" size={15} />
                    {repository.language ?? '其他语言'}
                  </span>
                  {repository.topics.slice(0, 5).map((topic) => (
                    <span key={topic} className="rounded-md bg-surface-container px-2 py-1 leading-none">
                      {topic}
                    </span>
                  ))}
                </div>

                {error ? (
                  <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-error" role="alert">
                    <Icon name="error" size={15} className="mt-0.5 shrink-0" />
                    {error}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col gap-3 xl:w-[310px] xl:items-end">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-on-surface-variant xl:justify-end">
                  <span className="inline-flex items-center gap-1" title="GitHub Stars">
                    <Icon name="star" size={15} />
                    {compactNumber(repository.starsCount)}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Forks">
                    <Icon name="fork_right" size={15} />
                    {compactNumber(repository.forksCount)}
                  </span>
                  <span>{activityDate ? `${formatDate(activityDate)} 更新` : '近期更新'}</span>
                </div>

                <CandidateActions
                  repository={repository}
                  status={status}
                  pendingAction={pendingAction}
                  disabled={isPending}
                  onOpenDetails={props.onOpenDetails}
                  onStar={props.onStar}
                  onUpdateStatus={props.onUpdateStatus}
                />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CandidateActions(props: {
  repository: GithubRepositoryRecommendation;
  status: CandidateStatus;
  pendingAction: DiscoveryCandidateAction | undefined;
  disabled: boolean;
  onOpenDetails: (repository: GithubRepositoryRecommendation) => void;
  onStar: (repository: GithubRepositoryRecommendation) => Promise<void>;
  onUpdateStatus: (repository: GithubRepositoryRecommendation, status: 'new' | 'marked' | 'ignored') => Promise<void>;
}) {
  if (props.status === 'starred') {
    return (
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        <Button size="sm" variant="outline" onClick={() => props.onOpenDetails(props.repository)}>
          <Icon name="menu_book" size={15} />
          查看介绍
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={props.repository.htmlUrl} target="_blank" rel="noreferrer">
            <Icon name="open_in_new" size={15} />
            GitHub
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          onClick={() => void props.onUpdateStatus(props.repository, 'new')}
          title="重新放回待处理列表，不会取消 GitHub Star"
        >
          <Icon name={props.pendingAction === 'restore' ? 'progress_activity' : 'restart_alt'} size={15} className={props.pendingAction === 'restore' ? 'animate-spin' : ''} />
          {props.pendingAction === 'restore' ? '恢复中' : '重新评估'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onOpenDetails(props.repository)}>
        <Icon name="menu_book" size={15} />
        查看介绍
      </Button>
      <Button size="sm" disabled={props.disabled} onClick={() => void props.onStar(props.repository)}>
        <Icon name={props.pendingAction === 'star' ? 'progress_activity' : 'star'} size={15} className={props.pendingAction === 'star' ? 'animate-spin' : ''} />
        {props.pendingAction === 'star' ? '添加中' : '加入 Stars'}
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => void props.onUpdateStatus(props.repository, props.status === 'marked' || props.status === 'ignored' ? 'new' : 'marked')}
      >
        <Icon
          name={props.pendingAction === 'mark' || props.pendingAction === 'restore' ? 'progress_activity' : props.status === 'marked' ? 'bookmark_remove' : props.status === 'ignored' ? 'undo' : 'bookmark_add'}
          size={15}
          className={props.pendingAction === 'mark' || props.pendingAction === 'restore' ? 'animate-spin' : ''}
        />
        {props.pendingAction === 'mark' || props.pendingAction === 'restore'
          ? '处理中'
          : props.status === 'marked'
            ? '取消标记'
            : props.status === 'ignored'
              ? '恢复候选'
              : '稍后研究'}
      </Button>

      {props.status !== 'ignored' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          onClick={() => void props.onUpdateStatus(props.repository, 'ignored')}
        >
          <Icon name={props.pendingAction === 'ignore' ? 'progress_activity' : 'visibility_off'} size={15} className={props.pendingAction === 'ignore' ? 'animate-spin' : ''} />
          {props.pendingAction === 'ignore' ? '忽略中' : '忽略'}
        </Button>
      ) : null}
    </div>
  );
}

function StatusBadge(props: { status: CandidateStatus }) {
  const labels: Record<CandidateStatus, string> = {
    new: '待处理',
    marked: '稍后研究',
    ignored: '已忽略',
    starred: '已加入 Stars',
  };
  const classes: Record<CandidateStatus, string> = {
    new: 'bg-surface-container text-on-surface-variant',
    marked: 'bg-primary/10 text-primary',
    ignored: 'bg-surface-container-high text-on-surface-variant',
    starred: 'bg-success/10 text-success',
  };
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${classes[props.status]}`}>{labels[props.status]}</span>;
}
