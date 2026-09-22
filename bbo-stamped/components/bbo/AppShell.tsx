'use client';

import { useEffect, useRef, useState } from 'react';
import { computeActivationCoverage } from '@/lib/coverage';
import { cx } from '@/lib/utils/format';
import { ActivationProvider, useStore } from './ActivationStore';
import { ActivationCreator } from './ActivationCreator';
import { PhotoViewerProvider } from './PhotoViewer';
import { PitchIntelScreen } from './PitchIntel';
import { SavedActivations } from './SavedActivations';
import {
  ExportScreen,
  FirstRun,
  ReelsScreen,
  SettingsScreen,
  ShotsScreen,
  SkitsScreen,
} from './Screens';
import { ShootMode } from './ShootMode';
import { Empty, ProgressOverlay, ScreenHead, Toast } from './ui';

type Tab = 'new' | 'reels' | 'shots' | 'skits' | 'shoot' | 'saved' | 'pitch' | 'export' | 'settings';

const PRIMARY: Array<{ tab: Tab; label: string; icon: string }> = [
  { tab: 'new', label: 'New', icon: '＋' },
  { tab: 'reels', label: 'Reels', icon: '▤' },
  { tab: 'shots', label: 'Shots', icon: '◇' },
  { tab: 'skits', label: 'Skits', icon: '☺' },
  { tab: 'shoot', label: 'Shoot', icon: '◎' },
  { tab: 'saved', label: 'Saved', icon: '◫' },
];

const SECONDARY: Array<{ tab: Tab; label: string }> = [
  { tab: 'pitch', label: 'Pitch intel' },
  { tab: 'export', label: 'Export' },
  { tab: 'settings', label: 'Settings' },
];

export function AppShell({ initialActivationId }: { initialActivationId?: string }) {
  return (
    <ActivationProvider>
      <PhotoViewerProvider>
        <Shell initialActivationId={initialActivationId} />
      </PhotoViewerProvider>
    </ActivationProvider>
  );
}

function Shell({ initialActivationId }: { initialActivationId?: string }) {
  const { activation, activations, hydrated, progress, toast, openActivation, closeActivation } =
    useStore();
  const [creatorRequested, setCreatorRequested] = useState(false);
  const [chosenTab, setChosenTab] = useState<Tab | null>(initialActivationId ? 'reels' : null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const requested = useRef(false);

  // Until the operator picks a tab, land somewhere useful: their saved work if
  // there is any, otherwise straight into a new activation. Derived, not an
  // effect, so the first paint after hydration is already correct.
  const tab: Tab = chosenTab ?? (hydrated && activations.length > 0 ? 'saved' : 'new');

  // Deep link: /activation/<id> opens that activation straight into the workspace.
  useEffect(() => {
    if (!initialActivationId || requested.current) return;
    requested.current = true;
    void openActivation(initialActivationId).then((found) => {
      if (!found) setNotFound(true);
    });
  }, [initialActivationId, openActivation]);

  const coverage = activation ? computeActivationCoverage(activation) : null;
  const outstanding = coverage ? coverage.totalShots - coverage.completedShots : 0;

  function go(next: Tab) {
    setChosenTab(next);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }

  /** Always starts a blank draft, even when another activation is open. */
  function startNew() {
    closeActivation();
    setCreatorRequested(true);
    go('new');
  }

  return (
    <div className="frame">
      <header className="masthead">
        <div>
          <div className="wordmark">BBO Stamped</div>
          <div className="masthead-sub">Reel production OS</div>
        </div>

        <div className="row-tight">
          <span className="status-pill">
            <span className={cx('status-dot', activation && 'live')} />
            {activation?.business.name.trim() || 'No activation'}
          </span>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((value) => !value)}
            >
              More
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="panel"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  zIndex: 80,
                  minWidth: 180,
                  boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
                }}
              >
                {SECONDARY.map((item) => (
                  <button
                    key={item.tab}
                    type="button"
                    role="menuitem"
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }}
                    onClick={() => go(item.tab)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="nav" aria-label="Main">
        {PRIMARY.map((item) => (
          <button
            key={item.tab}
            type="button"
            className="nav-tab"
            aria-current={tab === item.tab}
            onClick={() => go(item.tab)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
            {item.tab === 'shoot' && outstanding > 0 ? (
              <span className="nav-badge">{outstanding}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <main className="stage">
        {notFound ? (
          <div className="callout callout-red" style={{ marginBottom: 18 }}>
            That activation is not saved in this browser. Activations live on the device that
            created them.
          </div>
        ) : null}

        {tab === 'new' ? (
          !activation && !creatorRequested && activations.length === 0 ? (
            <FirstRun onCreate={startNew} />
          ) : (
            <ActivationCreator onAnalysed={() => go('reels')} />
          )
        ) : null}

        {tab === 'saved' ? (
          <SavedActivations onOpen={() => go('reels')} onCreate={startNew} />
        ) : null}

        {tab === 'pitch' ? <PitchIntelScreen /> : null}

        {tab === 'reels' ? (
          activation ? (
            <ReelsScreen activation={activation} onShotsBuilt={() => go('shots')} />
          ) : (
            <NoActivation onCreate={startNew} title="Reels" />
          )
        ) : null}

        {tab === 'shots' ? (
          activation ? (
            <ShotsScreen activation={activation} />
          ) : (
            <NoActivation onCreate={startNew} title="Shots" />
          )
        ) : null}

        {tab === 'skits' ? (
          activation ? (
            <SkitsScreen activation={activation} />
          ) : (
            <NoActivation onCreate={startNew} title="Skit lab" />
          )
        ) : null}

        {tab === 'shoot' ? (
          activation ? (
            <ShootMode activation={activation} onOpenBlueprints={() => go('export')} />
          ) : (
            <NoActivation onCreate={startNew} title="Shoot" />
          )
        ) : null}

        {tab === 'export' ? (
          activation ? (
            <ExportScreen activation={activation} />
          ) : (
            <NoActivation onCreate={startNew} title="Export" />
          )
        ) : null}

        {tab === 'settings' ? (
          activation ? (
            <SettingsScreen activation={activation} />
          ) : (
            <NoActivation onCreate={startNew} title="Settings" />
          )
        ) : null}
      </main>

      {progress ? <ProgressOverlay title={progress.title} steps={progress.steps} /> : null}
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}

function NoActivation({ onCreate, title }: { onCreate: () => void; title: string }) {
  return (
    <div>
      <ScreenHead title={title} />
      <Empty mark="◌" title="No activation open">
        Open one from Saved, or start a new one.
      </Empty>
      <button type="button" className="btn-primary" onClick={onCreate}>
        New activation
      </button>
    </div>
  );
}
