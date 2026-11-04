// Page chrome: header with wordmark, links and theme toggle; footer with credit and disclaimer.
import { REPO_URL, VIDEO_AUTHOR, VIDEO_TITLE, VIDEO_URL, videoAt } from './config';
import { GithubIcon, MoonIcon, ReceiptMark, SunIcon } from './icons';
import type { Theme } from './useTheme';

export function Header({
  view,
  theme,
  onToggleTheme,
}: {
  view: 'landing' | 'results';
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        {view === 'landing' ? (
          <a className="wordmark" href="#top" aria-label="Buildable, back to top">
            <ReceiptMark size={22} />
            <span>Buildable</span>
          </a>
        ) : (
          <span className="wordmark">
            <ReceiptMark size={22} />
            <span>Buildable</span>
          </span>
        )}
        <nav className="site-nav" aria-label="Site">
          {view === 'landing' && (
            <a className="site-nav__link" href="#how">
              How it works
            </a>
          )}
          <a className="site-nav__link site-nav__github" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <GithubIcon size={17} />
            <span className="site-nav__label">GitHub</span>
          </a>
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </nav>
      </div>
    </header>
  );
}

export function Footer({ pricesChecked }: { pricesChecked: string }) {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <p className="site-footer__credit">
          Inspired by{' '}
          <a href={VIDEO_URL} target="_blank" rel="noopener noreferrer">
            {VIDEO_AUTHOR}, &ldquo;{VIDEO_TITLE}&rdquo;
          </a>
          . Buildable builds on four of its ideas: cancelling subscriptions by building replacements
          (#10,{' '}
          <a href={videoAt(225)} target="_blank" rel="noopener noreferrer">
            3:45
          </a>
          ), replacing a paid baby-tracking app (#25,{' '}
          <a href={videoAt(643)} target="_blank" rel="noopener noreferrer">
            10:43
          </a>
          ), agents that haggle (#11,{' '}
          <a href={videoAt(248)} target="_blank" rel="noopener noreferrer">
            4:08
          </a>
          ), and old Kindles and iPads as home devices (#4 and #8,{' '}
          <a href={videoAt(102)} target="_blank" rel="noopener noreferrer">
            1:42
          </a>{' '}
          and{' '}
          <a href={videoAt(181)} target="_blank" rel="noopener noreferrer">
            3:01
          </a>
          ).
        </p>
        <p className="site-footer__legal">
          Not affiliated with Anthropic or any company listed. Prices checked {pricesChecked}. Not
          financial advice.{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
