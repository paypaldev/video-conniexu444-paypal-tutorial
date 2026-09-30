import { useApp } from '../state/AppContext.js';

interface SiteHeaderProps {
  onHome: () => void;
  onProfile: () => void;
}

export function SiteHeader({ onHome, onProfile }: SiteHeaderProps) {
  const { session, profile, openAuth, signOut } = useApp();
  const signedIn = !!session;

  // The display name, and never the email. The header is on every page,
  // including whatever is on screen when someone is shoulder-surfing or
  // a screen is being shared — the address is not something to publish
  // there. While the profile row is still in flight there is no name to
  // show yet, so the slot reads as the destination instead.
  const displayName = profile?.username ?? '';

  return (
    <header className="site-header">
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
      >
        {/* Decorative: the wordmark beside it already names the site, so
            announcing the image again would just be noise to a reader. */}
        <img className="brand-logo" src="assets/icon-192.png" alt="" width={28} height={28} />
        <span className="brand-mark">Kat</span>
        <span className="brand-name">SAT</span>
      </a>

      <nav className="site-nav">
        {signedIn && (
          <button type="button" className="profile-link" onClick={onProfile}>
            <span className="profile-link-avatar" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="profile-link-name">{displayName || 'Profile'}</span>
          </button>
        )}
        {signedIn ? (
          <button className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => openAuth()}>
            Sign in
          </button>
        )}
      </nav>
    </header>
  );
}
