import { z } from 'zod';
import { defineAction } from '../types';

const firstRowKeys = () =>
  z.boolean().default(true).meta({
    title: 'First row as keys',
    description: 'Objects keyed by the header row; off gives arrays of cells',
  });

export const spreadsheetSheetJson = defineAction({
  id: 'spreadsheet.sheetJson',
  title: 'Sheet as JSON',
  group: 'Convert',
  kinds: ['spreadsheet'],
  params: z.object({
    sheet: z.string().default('').meta({
      title: 'Sheet',
      description: 'Name or number (1 is the first); empty for the first',
    }),
    header: firstRowKeys(),
  }),
  label: p => (p.sheet.trim() ? `Sheet ${p.sheet.trim()} as JSON` : 'Sheet as JSON'),
});

export const spreadsheetAllJson = defineAction({
  id: 'spreadsheet.allJson',
  title: 'All sheets as JSON',
  group: 'Convert',
  kinds: ['spreadsheet'],
  params: z.object({ header: firstRowKeys() }),
  label: () => 'All sheets as JSON',
});

export const spreadsheetActions = [spreadsheetSheetJson, spreadsheetAllJson];
