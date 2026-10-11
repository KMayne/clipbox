import { register } from '../../core/interpreter';
import { pdfInterpreter } from './pdf';

export const interpreters = [register(pdfInterpreter)];
