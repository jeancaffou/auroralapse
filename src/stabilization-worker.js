import { Stabilizer } from "./stabilization.js";
let stabilizer;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "reference") {
      stabilizer = new Stabilizer(data.image);
      self.postMessage({ features: stabilizer.points.length });
    } else {
      self.postMessage({ motion: stabilizer.align(data.image) });
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
