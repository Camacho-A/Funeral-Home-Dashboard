// Regenerates domain/labels/manorsLabelTemplate.generated.ts from Manors'
// approved DYMO template (domain/labels/templates/manors-label.dymo). The
// .dymo file is never written to; only the generated module is.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}domain/labels/templates/manors-label.dymo`, 'utf8').replace(/^﻿/, '');

const header = `/**
 * GENERATED from domain/labels/templates/manors-label.dymo — do not edit.
 * Manors' approved DYMO label (2026-10), embedded so the server can fill a
 * copy without reading files at runtime. manorsLabel.test.ts fails if this
 * string and the .dymo file ever differ. Regenerate with
 * \`node scripts/generateManorsLabelTemplate.mjs\`.
 */
`;

writeFileSync(
  `${root}domain/labels/manorsLabelTemplate.generated.ts`,
  `${header}export const MANORS_LABEL_TEMPLATE_XML: string = ${JSON.stringify(source)};\n`,
);
