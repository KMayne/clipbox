import { register } from '../../core/interpreter';
import { x509ActionService } from './actions';
import { pemInterpreter } from './pem';

export const interpreters = [register(pemInterpreter)];

export const service = x509ActionService;
