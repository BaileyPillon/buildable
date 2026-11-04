import { useEffect, useRef } from 'react';
import { CloseIcon } from './icons';

const BANKS: { name: string; steps: string }[] = [
  {
    name: 'Chase',
    steps:
      'Sign in, open the account, choose "Download account activity" (the download icon above the transaction list), pick a date range, set the file type to CSV, and download.',
  },
  {
    name: 'Bank of America',
    steps:
      'Open the account, choose Download above the transactions, pick the date range, select the Microsoft Excel or CSV format, and download.',
  },
  {
    name: 'Wells Fargo',
    steps:
      'Open Account Activity, scroll to "Download Account Activity", pick a date range, choose Comma Separated, and download. These files have no header row, which is fine.',
  },
  {
    name: 'Citi',
    steps:
      'Open the account, choose Download transactions in Account Activity, pick the date range, choose CSV, and download.',
  },
  {
    name: 'Capital One',
    steps:
      'Open the account, choose View transactions, then Download transactions. Pick CSV (or QFX) and the longest date range offered.',
  },
  {
    name: 'American Express',
    steps:
      'Go to Statements & Activity, choose Download, pick CSV, tick the statement periods you want, and download.',
  },
  {
    name: 'Discover',
    steps:
      'Open Activity & Statements, choose Download, select CSV, pick the date range, and download.',
  },
  {
    name: 'Apple Card',
    steps:
      'On your iPhone open Wallet, tap Apple Card, then Card Balance, open a monthly statement and choose Export Transactions as CSV. Repeat for each month and drop the files here together.',
  },
  {
    name: 'US Bank',
    steps:
      'Open the account, go to Account Activity, choose the download icon, select CSV, pick the date range, and download.',
  },
  {
    name: 'Other banks',
    steps:
      'Look for Download or Export on the transactions page. Choose CSV (OFX, QFX or Quicken also work) and the longest date range available. If your bank offers only PDF statements, ask for a CSV export in online banking or try a credit card issuer that does.',
  },
];

export function BankHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="bank-help-title"
      onClose={onClose}
      onClick={(e) => {
        // click on the backdrop (the dialog element itself) closes it
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog__panel">
        <header className="dialog__head">
          <h2 id="bank-help-title" className="dialog__title">
            How to export a CSV from your bank
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <p className="dialog__lead">
          Menus change from time to time. Look for Download or Export on the transactions page, pick
          CSV (or OFX/QFX), and take the longest date range you can. Use several cards if you have them.
        </p>
        <ul className="bank-list">
          {BANKS.map((b) => (
            <li key={b.name} className="bank-list__item">
              <h3 className="bank-list__name">{b.name}</h3>
              <p className="bank-list__steps">{b.steps}</p>
            </li>
          ))}
        </ul>
        <p className="dialog__foot">
          The file is read in this tab and nothing is uploaded. The page&rsquo;s Content-Security-Policy blocks
          the browser&rsquo;s normal ways of sending it to a server.
        </p>
        <div className="dialog__done">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
