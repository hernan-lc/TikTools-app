import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { IconBolt, IconCheck, IconCoins, IconFlame, IconStar, IconTrash, IconTrophy } from '../components/icons.tsx';
import { Alert, Badge, Card, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { FieldRow, FormField } from '../components/ui/FormField.tsx';
import { NumberInput } from '../components/ui/NumberInput.tsx';
import { SearchInput, TextInput } from '../components/ui/TextInput.tsx';
import { SplitLayout } from '../components/ui/Page.tsx';
import { DataTable, RowActions, type Column } from '../components/ui/Table.tsx';
import { t, type Locale } from '../i18n.ts';
import type { ConnectionStatus, PointsConfig, ViewerRecord } from '../types.ts';

type PointsViewProps = {
  locale: Locale;
  config: PointsConfig;
  leaderboard: ViewerRecord[];
  status?: ConnectionStatus;
  onUpdateConfig: (updated: Partial<PointsConfig>) => void;
  onResetPoints: (uniqueId?: string) => void;
  onAdjustPoints: (uniqueId: string, delta: number) => void;
};

export function PointsView({ locale, config, leaderboard, status, onUpdateConfig, onResetPoints, onAdjustPoints }: PointsViewProps) {
  const isLive = status === 'connected' || status === 'connecting' || status === 'retrying';
  const [localConfig, setLocalConfig] = useState<PointsConfig>(config);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<string>('50');
  const [deductMode, setDeductMode] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<string>('points');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const leaderboardWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLocalConfig(config), [config]);

  // Auto-calc pageSize to fill available height and avoid empty gap (Image 1)
  useEffect(() => {
    const el = leaderboardWrapRef.current;
    if (!el) return;
    const ROW_H = 37; // td + border
    const compute = () => {
      // only auto on desktop where split is 2-col
      if (window.innerWidth <= 960) return;
      const rect = el.getBoundingClientRect();
      // available height = wrapper height; subtract search (~46) + pagination (~38)
      const avail = rect.height - 46 - 38 - 16;
      const rows = Math.floor(avail / ROW_H);
      const auto = Math.max(10, Math.min(50, rows > 0 ? rows : 10));
      // snap to 5 step to avoid jitter, keep minimal that fills
      const snapped = Math.ceil(auto / 5) * 5;
      setPageSize((prev) => (Math.abs(prev - snapped) > 2 ? snapped : prev));
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    // initial tick after layout
    requestAnimationFrame(compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);
  // reset page when search changes
  useEffect(() => setPage(1), [searchQuery, pageSize]);

  const handleSave = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (isLive) return;
    onUpdateConfig(localConfig);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleResetAll = () => {
    if (window.confirm(t(locale, 'resetPointsConfirm'))) onResetPoints();
  };

  const handleAdjustSubmit = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const base = parseFloat(adjustDelta);
    if (Number.isNaN(base)) return;
    const delta = deductMode ? -Math.abs(base) : Math.abs(base);
    onAdjustPoints(adjustTarget, delta);
    setAdjustTarget(null);
  };

  const filteredViewers = useMemo(() => {
    let out = leaderboard.filter((v) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().replace(/^@/, '');
      return v.uniqueId.toLowerCase().includes(q) || (v.nickname && v.nickname.toLowerCase().includes(q));
    });
    // sorting
    out = [...out].sort((a, b) => {
      if (sortBy === 'points') return sortDir === 'asc' ? a.points - b.points : b.points - a.points;
      if (sortBy === 'level') return sortDir === 'asc' ? a.level - b.level : b.level - a.level;
      if (sortBy === 'viewer') return sortDir === 'asc' ? a.uniqueId.localeCompare(b.uniqueId) : b.uniqueId.localeCompare(a.uniqueId);
      return 0;
    });
    return out;
  }, [leaderboard, searchQuery, sortBy, sortDir]);

  const openAdd = (id: string) => { setAdjustTarget(id); setAdjustDelta('50'); setDeductMode(false); };
  const openDeduct = (id: string) => { setAdjustTarget(id); setAdjustDelta('50'); setDeductMode(true); };

  const columns: Column<ViewerRecord>[] = [
    {
      key: 'rank',
      header: t(locale, 'rank'),
      width: '56px',
      render: (_row, idx) =>
        idx === 0 ? (
          <span style={{ color: '#b45309', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconTrophy /> 1
          </span>
        ) : idx === 1 ? (
          <span style={{ color: '#64748b', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconTrophy /> 2
          </span>
        ) : idx === 2 ? (
          <span style={{ color: '#92400e', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconTrophy /> 3
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>#{idx + 1}</span>
        ),
    },
    {
      key: 'viewer',
      header: t(locale, 'viewer'),
      sortable: true,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>@{row.uniqueId}</span>
          {row.isSubscriber ? (
            <span title="Subscriber" style={{ display: 'inline-flex', color: '#f59e0b' }}>
              <IconStar />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'level',
      header: t(locale, 'level'),
      width: '84px',
      sortable: true,
      render: (row) => (
        <span className="tt-badge-level" style={{ transform: 'scale(0.88)', transformOrigin: 'left' }}>
          <span className="tt-badge-icon">
            <IconBolt />
          </span>
          <span className="tt-badge-text">N.º {row.level}</span>
        </span>
      ),
    },
    {
      key: 'points',
      header: t(locale, 'points'),
      width: '88px',
      align: 'right',
      sortable: true,
      render: (row) => <span style={{ fontWeight: 700, color: 'var(--tt-pink)' }}>{row.points.toLocaleString()}</span>,
    },
    {
      key: 'actions',
      header: t(locale, 'actions'),
      width: '84px',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Button size="sm" variant="soft" tooltip={t(locale, 'addPoints')} onClick={() => openAdd(row.uniqueId)}>
            +
          </Button>
          <RowActions onAdd={() => openAdd(row.uniqueId)} onDeduct={() => openDeduct(row.uniqueId)} onReset={() => { if (confirm(`Reset @${row.uniqueId}?`)) onResetPoints(row.uniqueId); }} />
        </div>
      ),
    },
  ];

  return (
    <div className="view-container" style={{ flexDirection: 'column' }}>
      <SplitLayout
        left={
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {isLive ? <Alert variant="info">LIVE {t(locale, 'live')} — {t(locale, 'configLockedLive')}</Alert> : null}
            <Card title={t(locale, 'pointsSystem')} icon={<IconCoins />}>
              <TextInput
                id="tf-currency-name"
                value={localConfig.currencyName}
                onValueChange={(v) => setLocalConfig({ ...localConfig, currencyName: v })}
                label={t(locale, 'currencyName')}
                disabled={isLive}
              />

              <FieldRow label={t(locale, 'pointsPerCoin')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerCoinEnabled}
                    onCheckedChange={(v) => !isLive && setLocalConfig({ ...localConfig, pointsPerCoinEnabled: v })}
                    disabled={isLive}
                  />
                  <NumberInput
                    value={localConfig.pointsPerCoin}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerCoin: v })}
                    min={0}
                    step={0.1}
                    disabled={isLive || !localConfig.pointsPerCoinEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerShare')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerShareEnabled}
                    onCheckedChange={(v) => !isLive && setLocalConfig({ ...localConfig, pointsPerShareEnabled: v })}
                    disabled={isLive}
                  />
                  <NumberInput
                    value={localConfig.pointsPerShare}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerShare: v })}
                    min={0}
                    step={0.5}
                    disabled={isLive || !localConfig.pointsPerShareEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerChat')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerChatEnabled}
                    onCheckedChange={(v) => !isLive && setLocalConfig({ ...localConfig, pointsPerChatEnabled: v })}
                    disabled={isLive}
                  />
                  <NumberInput
                    value={localConfig.pointsPerChat}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerChat: v })}
                    min={0}
                    step={0.1}
                    disabled={isLive || !localConfig.pointsPerChatEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerLike')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerLikeEnabled}
                    onCheckedChange={(v) => !isLive && setLocalConfig({ ...localConfig, pointsPerLikeEnabled: v })}
                    disabled={isLive}
                  />
                  <NumberInput
                    value={localConfig.pointsPerLike}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerLike: v })}
                    min={0}
                    step={0.05}
                    disabled={isLive || !localConfig.pointsPerLikeEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerFollow')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerFollowEnabled}
                    onCheckedChange={(v) => !isLive && setLocalConfig({ ...localConfig, pointsPerFollowEnabled: v })}
                    disabled={isLive}
                  />
                  <NumberInput
                    value={localConfig.pointsPerFollow}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerFollow: v })}
                    min={0}
                    step={1}
                    disabled={isLive || !localConfig.pointsPerFollowEnabled}
                  />
                </div>
              </FieldRow>
            </Card>

            <Card title={t(locale, 'subBonus')} subtitle={t(locale, 'subBonusLead')} icon={<IconStar />}>
              <FieldRow label={t(locale, 'subBonusRatio')}>
                <NumberInput
                  value={localConfig.subBonusMultiplier}
                  onValueChange={(v) => setLocalConfig({ ...localConfig, subBonusMultiplier: v })}
                  min={0}
                  max={500}
                  step={5}
                  suffix="%"
                  disabled={isLive}
                />
              </FieldRow>
            </Card>

            <Card title={t(locale, 'levelConfig')} subtitle={t(locale, 'levelConfigLead')} icon={<IconFlame />}>
              <FieldRow label={t(locale, 'pointsPerLevel')}>
                <NumberInput
                  value={localConfig.pointsPerLevel}
                  onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerLevel: Math.max(10, v | 0) })}
                  min={10}
                  step={10}
                  disabled={isLive}
                />
              </FieldRow>
            </Card>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button type="submit" variant="primary" block icon={<IconCheck />} disabled={isLive}>
                {t(locale, 'savePointsConfig')}
              </Button>
              <Button variant="danger" icon={<IconTrash />} tooltip={t(locale, 'resetPoints')} onClick={handleResetAll} iconOnly disabled={isLive} />
            </div>

            {saveSuccess ? (
              <Alert variant="success">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IconCheck /> {t(locale, 'configSaved')}
                </span>
              </Alert>
            ) : null}
          </form>
        }
        right={
          <div ref={leaderboardWrapRef} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <Card title={t(locale, 'leaderboard')} icon={<IconTrophy />} action={<Badge>{filteredViewers.length} {t(locale, 'viewersCount')}</Badge>} padding="md" className="ui-card--fill">
              <div style={{ marginBottom: 10 }}>
                <SearchInput value={searchQuery} onValueChange={setSearchQuery} placeholder={t(locale, 'searchViewers')} />
              </div>
              <DataTable
                columns={columns}
                data={filteredViewers}
                rowKey="uniqueId"
                emptyState={<EmptyState title={t(locale, 'noData')} />}
                rowClassName={(_r, i) => (i < 3 ? `top-rank-${i + 1}` : undefined)}
                pagination={{ page, pageSize, total: filteredViewers.length, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); }, pageSizeOptions: [10, 15, 20, 30, 50] }}
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={(k, d) => { setSortBy(k); setSortDir(d); }}
              />
            </Card>
          </div>
        }
      />

      {adjustTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconCoins /> {deductMode ? 'Deduct' : 'Add'} Points: @{adjustTarget}
            </h2>
            <form onSubmit={handleAdjustSubmit}>
              <FormField label={deductMode ? 'Points to deduct:' : 'Points to add:'}>
                <NumberInput value={parseFloat(adjustDelta) || 0} onValueChange={(v) => setAdjustDelta(String(Math.abs(v)))} min={0} step={1} />
              </FormField>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <Button variant="soft" onClick={() => setAdjustTarget(null)}>
                  {t(locale, 'cancel')}
                </Button>
                <Button type="submit" variant={deductMode ? 'danger' : 'primary'}>
                  {deductMode ? 'Deduct' : t(locale, 'continue')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
