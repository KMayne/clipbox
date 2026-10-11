import { register } from '../../core/interpreter';
import { spreadsheetInterpreter } from './spreadsheet';

export const interpreters = [register(spreadsheetInterpreter)];
