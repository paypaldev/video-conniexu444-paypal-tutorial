import { useApp } from '../state/AppContext.js';

/**
 * The page-level message strip.
 *
 * Note the asymmetry: `text` goes through children (React escapes it),
 * `html` goes through dangerouslySetInnerHTML. Only literal markup
 * written in this codebase ever reaches the second branch — server
 * strings are always `text`, because a Postgres error echoes its input
 * back and would otherwise land in the DOM unescaped.
 */
export function Banner() {
  const { banner } = useApp();
  if (!banner) return null;

  if (banner.kind === 'html') {
    return <div className="banner" dangerouslySetInnerHTML={{ __html: banner.value }} />;
  }
  return <div className="banner">{banner.value}</div>;
}
