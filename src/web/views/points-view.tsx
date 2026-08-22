import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import {
  IconCheck,
  IconCoins,
  IconCrown,
  IconFlame,
  IconSearch,
  IconSettings,
  IconStar,
  IconTrash,
  IconTrophy,
} from '../components/icons.tsx';
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

export function PointsView({
  locale,
  config,
  leaderboard,
  onUpdateConfig,
  onResetPoints,
  onAdjustPoints,
}: PointsViewProps) {
  const [localConfig, setLocalConfig] = useState<PointsConfig>(config);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<string>('50');

  const handleSave = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    onUpdateConfig(localConfig);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleResetAll = () => {
    if (window.confirm(t(locale, 'resetPointsConfirm'))) {
      onResetPoints();
    }
  };

  const handleAdjustSubmit = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const delta = parseFloat(adjustDelta);
    if (!isNaN(delta)) {
      onAdjustPoints(adjustTarget, delta);
      setAdjustTarget(null);
    }
  };

  const filteredViewers = leaderboard.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().replace(/^@/, '');
    return v.uniqueId.toLowerCase().includes(q) || (v.nickname && v.nickname.toLowerCase().includes(q));
  });

  return (
    <div className="view-container">
      <div className="points-dashboard-layout">
        {/* Left Column: TikFinity-Style Config Cards */}
        <div className="points-config-column">
          <form onSubmit={handleSave}>
            {/* 1. Sistema de Puntos Card */}
            <div className="tikfinity-card">
              <h2 className="tikfinity-title">
                <IconCoins /> {t(locale, 'pointsSystem')}
              </h2>

              <div className="tikfinity-field-row">
                <label className="tikfinity-label" htmlFor="tf-currency-name">
                  {t(locale, 'currencyName')}
                </label>
                <input
                  id="tf-currency-name"
                  type="text"
                  className="tikfinity-input"
                  value={localConfig.currencyName}
                  onInput={(e) =>
                    setLocalConfig({ ...localConfig, currencyName: e.currentTarget.value })
                  }
                  placeholder={t(locale, 'currencyNamePlaceholder')}
                />
              </div>

              {/* Puntos por moneda */}
              <div className="tikfinity-toggle-row">
                <label className="tikfinity-checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.pointsPerCoinEnabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        pointsPerCoinEnabled: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>{t(locale, 'pointsPerCoin')}</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerCoin}
                  disabled={!localConfig.pointsPerCoinEnabled}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerCoin: parseFloat(e.currentTarget.value) || 0,
                    })
                  }
                />
              </div>

              {/* Puntos por compartir */}
              <div className="tikfinity-toggle-row">
                <label className="tikfinity-checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.pointsPerShareEnabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        pointsPerShareEnabled: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>{t(locale, 'pointsPerShare')}</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerShare}
                  disabled={!localConfig.pointsPerShareEnabled}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerShare: parseFloat(e.currentTarget.value) || 0,
                    })
                  }
                />
              </div>

              {/* Puntos por comentario */}
              <div className="tikfinity-toggle-row">
                <label className="tikfinity-checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.pointsPerChatEnabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        pointsPerChatEnabled: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>{t(locale, 'pointsPerChat')}</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerChat}
                  disabled={!localConfig.pointsPerChatEnabled}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerChat: parseFloat(e.currentTarget.value) || 0,
                    })
                  }
                />
              </div>

              {/* Puntos por Like */}
              <div className="tikfinity-toggle-row">
                <label className="tikfinity-checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.pointsPerLikeEnabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        pointsPerLikeEnabled: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>{t(locale, 'pointsPerLike')}</span>
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerLike}
                  disabled={!localConfig.pointsPerLikeEnabled}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerLike: parseFloat(e.currentTarget.value) || 0,
                    })
                  }
                />
              </div>

              {/* Puntos por Seguir */}
              <div className="tikfinity-toggle-row">
                <label className="tikfinity-checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.pointsPerFollowEnabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        pointsPerFollowEnabled: e.currentTarget.checked,
                      })
                    }
                  />
                  <span>{t(locale, 'pointsPerFollow')}</span>
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerFollow}
                  disabled={!localConfig.pointsPerFollowEnabled}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerFollow: parseFloat(e.currentTarget.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            {/* 2. Bono para Suscriptores Card */}
            <div className="tikfinity-card">
              <h2 className="tikfinity-title">
                <IconStar /> {t(locale, 'subBonus')}
              </h2>
              <p className="tikfinity-desc">{t(locale, 'subBonusLead')}</p>

              <div className="tikfinity-field-row">
                <label className="tikfinity-label" htmlFor="tf-sub-multiplier">
                  {t(locale, 'subBonusRatio')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    id="tf-sub-multiplier"
                    type="number"
                    step="5"
                    min="0"
                    max="500"
                    className="tikfinity-number-input"
                    value={localConfig.subBonusMultiplier}
                    onInput={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        subBonusMultiplier: parseFloat(e.currentTarget.value) || 0,
                      })
                    }
                  />
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>%</span>
                </div>
              </div>
            </div>

            {/* 3. Configuraciones de Nivel Card */}
            <div className="tikfinity-card">
              <h2 className="tikfinity-title">
                <IconFlame /> {t(locale, 'levelConfig')}
              </h2>
              <p className="tikfinity-desc">{t(locale, 'levelConfigLead')}</p>

              <div className="tikfinity-field-row">
                <label className="tikfinity-label" htmlFor="tf-level-points">
                  {t(locale, 'pointsPerLevel')}
                </label>
                <input
                  id="tf-level-points"
                  type="number"
                  step="10"
                  min="10"
                  className="tikfinity-number-input"
                  value={localConfig.pointsPerLevel}
                  onInput={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      pointsPerLevel: parseInt(e.currentTarget.value, 10) || 100,
                    })
                  }
                />
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                <IconCheck /> {t(locale, 'savePointsConfig')}
              </button>
              <button
                type="button"
                className="btn-danger"
                style={{ padding: '0 12px' }}
                data-tooltip={t(locale, 'resetPoints')}
                data-tooltip-pos="top"
                onClick={handleResetAll}
              >
                <IconTrash />
              </button>
            </div>

            {saveSuccess ? (
              <div className="success-banner" style={{ marginTop: '10px' }}>
                ✓ {t(locale, 'configSaved')}
              </div>
            ) : null}
          </form>
        </div>

        {/* Right Column: SQLite Points Leaderboard Table */}
        <div className="points-leaderboard-column">
          <div className="tikfinity-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h2 className="tikfinity-title" style={{ margin: 0 }}>
                <IconTrophy /> {t(locale, 'leaderboard')}
              </h2>
              <span className="badge-pill" style={{ background: 'var(--input-bg)' }}>
                {filteredViewers.length} {t(locale, 'viewersCount')}
              </span>
            </header>

            {/* Search filter */}
            <div className="feed-search-wrap" style={{ width: '100%', marginBottom: '12px' }}>
              <span className="search-icon">
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder={t(locale, 'searchViewers')}
                value={searchQuery}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Leaderboard Table Container */}
            <div className="leaderboard-table-scroll">
              {filteredViewers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  {t(locale, 'noData')}
                </div>
              ) : (
                <table className="tikfinity-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>{t(locale, 'rank')}</th>
                      <th>{t(locale, 'viewer')}</th>
                      <th style={{ width: '70px' }}>{t(locale, 'level')}</th>
                      <th style={{ width: '80px', textAlign: 'right' }}>{t(locale, 'points')}</th>
                      <th style={{ width: '70px', textAlign: 'right' }}>{t(locale, 'actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredViewers.map((viewer, idx) => (
                      <tr key={viewer.uniqueId} className={idx < 3 ? `top-rank-${idx + 1}` : ''}>
                        <td>
                          {idx === 0 ? (
                            <span style={{ color: '#ffd700', fontWeight: 800 }}>🥇 1</span>
                          ) : idx === 1 ? (
                            <span style={{ color: '#c0c0c0', fontWeight: 800 }}>🥈 2</span>
                          ) : idx === 2 ? (
                            <span style={{ color: '#cd7f32', fontWeight: 800 }}>🥉 3</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>#{idx + 1}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="table-viewer-name">@{viewer.uniqueId}</span>
                            {viewer.isSubscriber ? <span title="Subscriber">⭐</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className="tt-badge-level" style={{ transform: 'scale(0.85)', transformOrigin: 'left' }}>
                            <span className="tt-badge-icon">⚡</span>
                            <span className="tt-badge-text">N.º {viewer.level}</span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--tt-pink)' }}>
                          {viewer.points.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn-icon"
                            style={{ width: '24px', height: '24px', fontSize: '11px' }}
                            data-tooltip={t(locale, 'addPoints')}
                            data-tooltip-pos="left"
                            onClick={() => setAdjustTarget(viewer.uniqueId)}
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Adjust Points Modal */}
      {adjustTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>
              <IconCoins /> Adjust Points: @{adjustTarget}
            </h2>
            <form onSubmit={handleAdjustSubmit}>
              <div className="form-group">
                <label>Points to Add or Deduct (use negative to deduct):</label>
                <input
                  type="number"
                  step="1"
                  value={adjustDelta}
                  onInput={(e) => setAdjustDelta(e.currentTarget.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setAdjustTarget(null)}>
                  {t(locale, 'cancel')}
                </button>
                <button type="submit" className="btn-primary">
                  {t(locale, 'continue')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
