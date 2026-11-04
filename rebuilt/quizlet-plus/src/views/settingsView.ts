import { h, clear, append, toast, download, stamp, bytes, type Screen } from '../dom';
import * as db from '../db';
import { buildAllCsv, buildBackupJson, markBackedUp } from '../backup';
import { getSettings, updateSettings } from '../settings';
import { canInstall, isStandalone, onInstallChange, promptInstall } from '../pwa';
import { relTime } from './common';

export async function settingsScreen(): Promise<Screen> {
  const s = getSettings();
  const lastBackup = await db.getMeta<number>('lastBackup');
  const snap = await db.snapshot();
  const storage = await db.estimateStorage();

  const backupStatus = h('p', { class: 'muted' });
  const showStatus = (ts?: number) => {
    backupStatus.textContent = `Last backup from this browser: ${relTime(ts)}. ${snap.decks.length} deck${snap.decks.length === 1 ? '' : 's'}, ${snap.cards.length} cards, ${snap.reviews.length} reviews stored.`;
  };
  showStatus(lastBackup);

  const storageBox = h('div', { class: 'muted' });
  const renderStorage = (est: typeof storage) => {
    clear(storageBox);
    if (!est) {
      storageBox.append('Storage details are not available in this browser.');
      return;
    }
    append(storageBox, [
      h('p', null, `Using ${bytes(est.usage)} of roughly ${bytes(est.quota)} allowed. Persistent storage: ${est.persisted ? 'granted (the browser will not clear it automatically)' : 'not granted (the browser may clear it if the device runs low on space)'}.`),
      est.persisted
        ? null
        : h('button', { class: 'btn small', onclick: async () => { const ok = await db.requestPersistence(); toast(ok ? 'Persistent storage granted.' : 'The browser declined. Back up regularly instead.'); renderStorage(await db.estimateStorage()); } }, 'Ask the browser to keep my data'),
    ]);
  };
  renderStorage(storage);

  const retention = h('input', { type: 'number', min: 0.7, max: 0.99, step: 0.01, value: String(s.requestRetention), 'aria-label': 'Desired retention' });
  const newPer = h('input', { type: 'number', min: 0, max: 9999, value: String(s.defaultNewPerDay) });
  const revPer = h('input', { type: 'number', min: 0, max: 99999, value: String(s.defaultReviewsPerDay) });
  const theme = h('select', { 'aria-label': 'Theme' }, h('option', { value: 'auto' }, 'Match my device'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'));
  theme.value = s.theme;
  theme.addEventListener('change', () => void updateSettings({ theme: theme.value as 'auto' | 'light' | 'dark' }));

  const installBox = h('div');
  const renderInstall = () => {
    clear(installBox);
    if (isStandalone()) installBox.append(h('p', { class: 'muted' }, 'Running as an installed app.'));
    else if (canInstall()) installBox.append(h('button', { class: 'btn', onclick: () => void promptInstall() }, 'Install the app'));
    else installBox.append(h('p', { class: 'muted' }, 'To install: use your browser’s menu (Install app / Add to Home Screen). It then opens in its own window and works offline.'));
  };
  renderInstall();
  const off = onInstallChange(renderInstall);

  const el = h(
    'section',
    { class: 'screen' },
    h('h1', null, 'Backup & settings'),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Back up your decks'),
      h('p', null, 'There is no account and no server. Your decks, images and study history live only in this browser’s storage on this device. Clearing site data, uninstalling the browser or switching devices loses them unless you have a backup file.'),
      backupStatus,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                download(`flashcards-backup-${stamp()}.json`, await buildBackupJson(), 'application/json');
                await markBackedUp();
                showStatus(Date.now());
                toast('Backup downloaded. Keep it somewhere safe (cloud drive, email to yourself).');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Backup failed.', 'error');
              }
            },
          },
          'Download full backup (JSON)',
        ),
        h('button', { class: 'btn', onclick: async () => download(`flashcards-all-decks-${stamp()}.csv`, await buildAllCsv(), 'text/csv;charset=utf-8') }, 'Export all cards (CSV, text only)'),
        h('a', { class: 'btn', href: '#/import' }, 'Restore from a backup'),
      ),
      h(
        'details',
        null,
        h('summary', null, 'How backups work'),
        h(
          'ul',
          null,
          h('li', null, h('b', null, 'JSON backup'), ' contains every deck, card, image, each card’s schedule, your full review history and settings. Use it to move to a new device or recover after a wipe.'),
          h('li', null, h('b', null, 'CSV'), ' contains only the text of the front and back (plus the deck name). It opens in Excel or Google Sheets and imports into other flashcard apps, but loses images and schedules.'),
          h('li', null, h('b', null, 'Restore'), ' with Import: choose the JSON file, then merge, import as copies, or replace everything.'),
          h('li', null, 'Back up after each long study session or at least every couple of weeks. The deck list reminds you when it has been 14 days.'),
        ),
      ),
      storageBox,
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Study settings'),
      h(
        'form',
        {
          class: 'settings-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const r = Math.min(0.99, Math.max(0.7, Number(retention.value) || 0.9));
            await updateSettings({ requestRetention: r, defaultNewPerDay: Math.max(0, Math.floor(Number(newPer.value) || 0)), defaultReviewsPerDay: Math.max(0, Math.floor(Number(revPer.value) || 0)) });
            retention.value = String(r);
            toast('Settings saved.');
          },
        },
        h('label', null, 'Desired retention (0.70 to 0.99)', retention, h('span', { class: 'muted' }, 'Higher means shorter intervals and more reviews. 0.90 is the FSRS default.')),
        h('label', null, 'New cards per day for new decks', newPer),
        h('label', null, 'Maximum reviews per day for new decks', revPer),
        h('button', { class: 'btn', type: 'submit' }, 'Save'),
      ),
      h('label', { class: 'inline' }, 'Theme ', theme),
    ),
    h('div', { class: 'panel' }, h('h2', null, 'Install'), installBox),
    h(
      'div',
      { class: 'panel danger-zone' },
      h('h2', null, 'Erase everything'),
      h('p', { class: 'muted' }, 'Deletes all decks, cards and history from this browser. Download a backup first.'),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: async () => {
            const answer = window.prompt('This permanently deletes all your decks on this device. Type DELETE to confirm.');
            if (answer !== 'DELETE') return;
            await db.writeAll({ decks: [], cards: [], reviews: [] }, true);
            toast('Everything was erased.');
            location.hash = '#/';
          },
        },
        'Erase all data',
      ),
    ),
  );
  return { el, destroy: off };
}
