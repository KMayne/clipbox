import { register } from '../../core/interpreter';
import { audioInterpreter, videoInterpreter } from './media';

export const interpreters = [register(audioInterpreter), register(videoInterpreter)];
