import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import type { Box } from './geometry';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';
export type FieldValue = string | boolean | string[];

export interface FormWidget {
  fieldName: string;
  kind: FieldKind;
  page: number; // 0-based
  rect: Box; // PDF user space [x0, y0, x1, y1]
  multiline: boolean;
  password: boolean;
  maxLength?: number;
  options: string[];
  onValue?: string; // radio button value for this widget
  multiselect: boolean;
  readOnly: boolean;
}

export interface FormInfo {
  widgets: FormWidget[];
  initial: Record<string, FieldValue>;
  skipped: string[]; // fields we cannot edit (buttons, signature fields, malformed)
}

/** Which page does each annotation dictionary live on? */
function annotationPages(doc: PDFDocument): Map<PDFDict, number> {
  const map = new Map<PDFDict, number>();
  doc.getPages().forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const d = annots.lookupMaybe(k, PDFDict);
      if (d) map.set(d, i);
    }
  });
  return map;
}

export function readForm(doc: PDFDocument): FormInfo {
  const info: FormInfo = { widgets: [], initial: {}, skipped: [] };
  if (!doc.catalog.has(PDFName.of('AcroForm'))) return info; // nothing to fill (and do not create an empty form)
  const pageOf = annotationPages(doc);
  const pages = doc.getPages();
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return info;
  }
  for (const field of fields) {
    const name = field.getName();
    try {
      let kind: FieldKind;
      let options: string[] = [];
      let multiline = false;
      let password = false;
      let multiselect = false;
      let maxLength: number | undefined;
      if (field instanceof PDFTextField) {
        kind = 'text';
        multiline = field.isMultiline();
        password = field.isPassword();
        maxLength = field.getMaxLength();
        info.initial[name] = field.getText() ?? '';
      } else if (field instanceof PDFCheckBox) {
        kind = 'checkbox';
        info.initial[name] = field.isChecked();
      } else if (field instanceof PDFRadioGroup) {
        kind = 'radio';
        options = field.getOptions();
        info.initial[name] = field.getSelected() ?? '';
      } else if (field instanceof PDFDropdown) {
        kind = 'dropdown';
        options = field.getOptions();
        info.initial[name] = field.getSelected()[0] ?? '';
      } else if (field instanceof PDFOptionList) {
        kind = 'list';
        options = field.getOptions();
        multiselect = field.isMultiselect();
        info.initial[name] = field.getSelected();
      } else {
        info.skipped.push(name);
        continue;
      }
      const readOnly = field.isReadOnly();
      for (const w of field.acroField.getWidgets()) {
        let page = pageOf.get(w.dict);
        if (page === undefined) {
          const pref = w.P();
          if (pref) {
            const idx = pages.findIndex((p) => p.ref === pref);
            if (idx >= 0) page = idx;
          }
        }
        if (page === undefined) continue;
        const r = w.getRectangle();
        info.widgets.push({
          fieldName: name,
          kind,
          page,
          rect: [r.x, r.y, r.x + r.width, r.y + r.height],
          multiline,
          password,
          maxLength,
          options,
          onValue: kind === 'radio' ? w.getOnValue()?.decodeText() : undefined,
          multiselect,
          readOnly,
        });
      }
    } catch {
      info.skipped.push(name);
    }
  }
  return info;
}

/** Write the user's values into the form. Returns human-readable warnings for anything that failed. */
export function applyFormValues(doc: PDFDocument, values: Record<string, FieldValue>): string[] {
  const warnings: string[] = [];
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) {
        const s = String(v ?? '');
        if (s) f.setText(s);
        else f.setText(undefined);
      } else if (f instanceof PDFCheckBox) {
        if (v) f.check();
        else f.uncheck();
      } else if (f instanceof PDFRadioGroup) {
        if (v) f.select(String(v));
        else f.clear();
      } else if (f instanceof PDFDropdown) {
        if (v) f.select(String(v));
        else f.clear();
      } else if (f instanceof PDFOptionList) {
        const list = Array.isArray(v) ? v : v ? [String(v)] : [];
        if (list.length) f.select(list);
        else f.clear();
      }
    } catch (e) {
      warnings.push(`Field "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return warnings;
}
