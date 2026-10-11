import { ModelOperations } from '@vscode/vscode-languagedetection';
import weightsUrl from '@vscode/vscode-languagedetection/model/group1-shard1of1.bin?url';
import modelJsonUrl from '@vscode/vscode-languagedetection/model/model.json?url';
import { createDetector } from './detector';

const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res;
};

const model = new ModelOperations({
  modelJsonLoaderFunc: async () => (await fetchOk(modelJsonUrl)).json(),
  weightsLoaderFunc: async () => (await fetchOk(weightsUrl)).arrayBuffer(),
});

export const service = createDetector(model);
