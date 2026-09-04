<script lang="tsx">
import { IconBarChart, IconChat, IconGift, IconHeart, IconTrophy, IconUsers } from '../components/icons.vue';
import { Badge, Card, EmptyState } from '../components/ui/Card.vue';
import { Page, PageHeader, StatCard, StatGrid } from '../components/ui/Page.vue';
import { DataTable, type Column } from '../components/ui/Table.vue';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, StreamTelemetry } from '../types.ts';

type AnalyticsViewProps = {
  locale: Locale;
  telemetry: StreamTelemetry;
  events: DisplayEvent[];
};

type TopRow = { user: string; count: number };

export function AnalyticsView({ locale, telemetry, events }: AnalyticsViewProps) {
  const authorCounts = new Map<string, number>();
  events.forEach((ev) => {
    authorCounts.set(ev.author, (authorCounts.get(ev.author) ?? 0) + 1);
  });
  const topChatters: TopRow[] = Array.from(authorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([user, count]) => ({ user, count }));

  const totalEvents = telemetry.chats + telemetry.gifts + telemetry.likes + telemetry.members;

  const columns: Column<TopRow>[] = [
    {
      key: 'rank',
      header: t(locale, 'rank'),
      width: '56px',
      render: (_row, idx) =>
        idx < 3 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 800, color: idx === 0 ? '#b45309' : idx === 1 ? '#64748b' : '#92400e' }}>
            <IconTrophy /> {idx + 1}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>#{idx + 1}</span>
        ),
    },
    {
      key: 'user',
      header: t(locale, 'viewer'),
      render: (row) => <span style={{ fontWeight: 600 }}>@{row.user}</span>,
    },
    {
      key: 'count',
      header: t(locale, 'points'),
      width: '110px',
      align: 'right' as const,
      render: (row) => <span style={{ fontWeight: 700 }}>{row.count} events</span>,
    },
  ];

  return (
    <Page>
      <PageHeader title={t(locale, 'tabAnalytics')} icon={<IconBarChart />} meta={<Badge>{t(locale, 'messageCountMany', { count: totalEvents })}</Badge>} />

      <StatGrid>
        <StatCard icon={<IconChat />} value={telemetry.chats.toLocaleString()} label={t(locale, 'statsChats')} tone="cyan" />
        <StatCard icon={<IconGift />} value={telemetry.gifts.toLocaleString()} label={t(locale, 'statsGifts')} tone="pink" />
        <StatCard icon={<IconHeart />} value={telemetry.likes.toLocaleString()} label={t(locale, 'statsLikes')} tone="yellow" />
        <StatCard icon={<IconUsers />} value={telemetry.members.toLocaleString()} label={t(locale, 'statsMembers')} tone="green" />
      </StatGrid>

      <Card title={t(locale, 'topChatters')} icon={<IconUsers />} action={<Badge tone="neutral">{topChatters.length} / 20</Badge>}>
        <DataTable
          columns={columns}
          data={topChatters}
          rowKey={(r) => r.user}
          emptyState={<EmptyState title={t(locale, 'noData')} description={t(locale, 'noData')} />}
          rowClassName={(_r, i) => (i < 3 ? `top-rank-${i + 1}` : undefined)}
        />
      </Card>
    </Page>
  );
}

export default AnalyticsView;
</script>
