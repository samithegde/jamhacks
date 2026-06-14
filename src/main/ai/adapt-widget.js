const {
  parseLearningWidget,
  extractDiagramFromExplanation,
} = require("./learning-widget-schema");

function adaptGeminiToLearningWidget({ explanation } = {}) {
  const { diagramCode, explanation: cleanExplanation } =
    extractDiagramFromExplanation(explanation);

  return parseLearningWidget({
    explanation: cleanExplanation,
    diagramCode,
  });
}

module.exports = {
  adaptGeminiToLearningWidget,
};
