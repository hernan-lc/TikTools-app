import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { IconBolt, IconCheck, IconCoins, IconFlame, IconStar, IconTrash, IconTrophy } from '../components/icons.tsx';
import { Alert, Badge, Card, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { FieldRow, FormField } from '../components/ui/FormField.tsx';
import { NumberInput } from '../components/ui/NumberInput.tsx';
import { TextInput, SearchInput } from '../components/ui/TextInput.tsx';
import { SplitLayout } from '../components/ui/Page.tsx';
import { DataTable, type Column } from '../components/ui/Table.tsx';
import { t, type Locale } from '../i18n.ts';
import type { PointsConfig, ViewerRecord } from '../types.ts';

type PointsViewProps = {
  locale: Locale;
  config: PointsConfig;
  leaderboard: ViewerRecord[];
  onUpdateConfig: (updated: Partial<PointsConfig>) => void;
  onResetPoints: (uniqueId?: string) => void;
  onAdjustPoints: (uniqueId: string, delta: number) => void;
};

export function PointsView({ locale, config, leaderboard, onUpdateConfig, onResetPoints, onAdjustPoints }: PointsViewProps) {
  const [localConfig, setLocalConfig] = useState<PointsConfig>(config);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<string>('50');

  useEffect(() => setLocalConfig(config), [config]);

  const handleSave = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
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
    const delta = parseFloat(adjustDelta);
    if (!Number.isNaN(delta)) {
      onAdjustPoints(adjustTarget, delta);
      setAdjustTarget(null);
    }
  };

  const filteredViewers = leaderboard.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().replace(/^@/, '');
    return v.uniqueId.toLowerCase().includes(q) || (v.nickname && v.nickname.toLowerCase().includes(q));
  });

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
      render: (row) => <span style={{ fontWeight: 700, color: 'var(--tt-pink)' }}>{row.points.toLocaleString()}</span>,
    },
    {
      key: 'actions',
      header: t(locale, 'actions'),
      width: '64px',
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="soft" tooltip={t(locale, 'addPoints')} onClick={() => setAdjustTarget(row.uniqueId)}>
          +
        </Button>
      ),
    },
  ];

  return (
    <div className="view-container" style={{ flexDirection: 'column' }}>
      <SplitLayout
        left={
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 1. Sistema de Puntos */}
            <Card title={t(locale, 'pointsSystem')} icon={<IconCoins />}>
              <FormField label={t(locale, 'currencyName')} htmlFor="tf-currency-name">
                <TextInput
                  id="tf-currency-name"
                  value={localConfig.currencyName}
                  onValueChange={(v) => setLocalConfig({ ...localConfig, currencyName: v })}
                  placeholder={t(locale, 'currencyNamePlaceholder')}
                />
              </FormField>

              <FieldRow label={t(locale, 'pointsPerCoin')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerCoinEnabled}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, pointsPerCoinEnabled: v })}
                  />
                  <NumberInput
                    value={localConfig.pointsPerCoin}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerCoin: v })}
                    min={0}
                    step={0.1}
                    disabled={!localConfig.pointsPerCoinEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerShare')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerShareEnabled}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, pointsPerShareEnabled: v })}
                  />
                  <NumberInput
                    value={localConfig.pointsPerShare}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerShare: v })}
                    min={0}
                    step={0.5}
                    disabled={!localConfig.pointsPerShareEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerChat')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerChatEnabled}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, pointsPerChatEnabled: v })}
                  />
                  <NumberInput
                    value={localConfig.pointsPerChat}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerChat: v })}
                    min={0}
                    step={0.1}
                    disabled={!localConfig.pointsPerChatEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerLike')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerLikeEnabled}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, pointsPerLikeEnabled: v })}
                  />
                  <NumberInput
                    value={localConfig.pointsPerLike}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerLike: v })}
                    min={0}
                    step={0.05}
                    disabled={!localConfig.pointsPerLikeEnabled}
                  />
                </div>
              </FieldRow>

              <FieldRow label={t(locale, 'pointsPerFollow')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={localConfig.pointsPerFollowEnabled}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, pointsPerFollowEnabled: v })}
                  />
                  <NumberInput
                    value={localConfig.pointsPerFollow}
                    onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerFollow: v })}
                    min={0}
                    step={1}
                    disabled={!localConfig.pointsPerFollowEnabled}
                  />
                </div>
              </FieldRow>
            </Card>

            {/* 2. Bono Suscriptores */}
            <Card title={t(locale, 'subBonus')} subtitle={t(locale, 'subBonusLead')} icon={<IconStar />}>
              <FieldRow label={t(locale, 'subBonusRatio')}>
                <NumberInput
                  value={localConfig.subBonusMultiplier}
                  onValueChange={(v) => setLocalConfig({ ...localConfig, subBonusMultiplier: v })}
                  min={0}
                  max={500}
                  step={5}
                  suffix="%"
                />
              </FieldRow>
            </Card>

            {/* 3. Nivel */}
            <Card title={t(locale, 'levelConfig')} subtitle={t(locale, 'levelConfigLead')} icon={<IconFlame />}>
              <FieldRow label={t(locale, 'pointsPerLevel')}>
                <NumberInput
                  value={localConfig.pointsPerLevel}
                  onValueChange={(v) => setLocalConfig({ ...localConfig, pointsPerLevel: Math.max(10, v | 0) })}
                  min={10}
                  step={10}
                />
              </FieldRow>
            </Card>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button type="submit" variant="primary" block icon={<IconCheck />}>
                {t(locale, 'savePointsConfig')}
              </Button>
              <Button variant="danger" icon={<IconTrash />} tooltip={t(locale, 'resetPoints')} onClick={handleResetAll} iconOnly />
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
            />
          </Card>
        }
      />

      {/* Adjust Points Modal */}
      {adjustTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconCoins /> Adjust Points: @{adjustTarget}
            </h2>
            <form onSubmit={handleAdjustSubmit}>
              <FormField label="Points to Add or Deduct (use negative to deduct):">
                <NumberInput value={parseFloat(adjustDelta) || 0} onValueChange={(v) => setAdjustDelta(String(v))} step={1} />
              </FormField>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <Button variant="soft" onClick={() => setAdjustTarget(null)}>
                  {t(locale, 'cancel')}
                </Button>
                <Button type="submit" variant="primary">
                  {t(locale, 'continue')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
