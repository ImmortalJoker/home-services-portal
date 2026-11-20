import { useEffect, useState } from 'react';
import { detectMobilePlatform } from '../deploy/authentik/portal/launch.mjs';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function standalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallPortal() {
  const [installed, setInstalled] = useState(standalone);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const platform = detectMobilePlatform(navigator);
  useEffect(() => {
    const offer = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  if (installed || (!platform && !prompt)) return null;
  async function install() {
    if (!prompt) { setHelp(!help); return; }
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
    } catch { setHelp(true); }
    finally { setPrompt(null); setBusy(false); }
  }
  return <div className="portal-install">
    <button type="button" onClick={() => void install()} disabled={busy} aria-label={busy ? 'Opening installer…' : 'Install portal'}>{busy ? 'Opening installer…' : <>Install<span className="install-context"> portal</span></>}</button>
    {help && <p className="install-help" role="status">{platform === 'ios'
      ? 'Open this page in Safari. Tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown, then tap Add.'
      : 'Open this page in Chrome. In the browser menu, choose Add to home screen or Install app. If you opened this inside another app, open it in Chrome first.'}</p>}
  </div>;
}
