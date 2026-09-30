/**
 * Desmos calculator, embedded beside the question.
 *
 * The URL is the *testing* build — the same restricted graphing
 * calculator students get inside Bluebook on the digital SAT — rather
 * than the full desmos.com/calculator. Practising against the tool you
 * will actually have is the point.
 *
 * Framing works because desmos.com sends no X-Frame-Options and no CSP
 * frame-ancestors. That is a technical permission, not a licence: if
 * Desmos ever asks us to stop embedding, set EMBED to false and the pane
 * degrades to the open-in-a-tab button that is already here.
 */

const CALCULATOR_URL = 'https://www.desmos.com/testing/default/graphing';
const EMBED = true;

interface CalculatorPaneProps {
  onClose: () => void;
}

export function CalculatorPane({ onClose }: CalculatorPaneProps) {
  return (
    <aside className="calc-pane" aria-label="Graphing calculator">
      <div className="calc-bar">
        <span className="calc-title">Calculator</span>
        <a
          className="btn btn-ghost btn-calc"
          href={CALCULATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the calculator in a new tab"
        >
          New tab ↗
        </a>
        <button type="button" className="btn btn-ghost btn-calc" onClick={onClose}>
          Hide
        </button>
      </div>

      {EMBED ? (
        <iframe
          className="calc-frame"
          src={CALCULATOR_URL}
          title="Desmos graphing calculator"
          /* No allow-downloads or allow-top-navigation: the calculator
             needs scripts and same-origin for its own storage, nothing
             that reaches back out to this page. */
          sandbox="allow-scripts allow-same-origin allow-popups"
          loading="lazy"
        />
      ) : (
        <div className="calc-fallback">
          <p>Open the graphing calculator in a new tab.</p>
          <a className="btn btn-primary" href={CALCULATOR_URL} target="_blank" rel="noopener noreferrer">
            Open Desmos ↗
          </a>
        </div>
      )}
    </aside>
  );
}
