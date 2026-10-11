import { register } from '../../core/interpreter';
import { pemInterpreter } from './pem';

export const interpreters = [register(pemInterpreter)];
