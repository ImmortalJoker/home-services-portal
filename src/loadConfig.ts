import rawConfig from '../public/services.json';
import { validateConfig } from './config';

export function loadConfig() {
  return validateConfig(rawConfig);
}
