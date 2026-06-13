function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveMark(step, marks = []) {
  const markId = asFiniteNumber(step?.markId);
  if (markId === null) {
    const x = asFiniteNumber(step?.x);
    const y = asFiniteNumber(step?.y);
    if (x === null || y === null) return null;

    const w = asFiniteNumber(step?.w);
    const h = asFiniteNumber(step?.h);
    return {
      x: Math.round(x),
      y: Math.round(y),
      w: w === null ? null : Math.round(w),
      h: h === null ? null : Math.round(h),
      mark: null,
      coarseMethod: "legacy",
    };
  }

  const mark = marks.find((candidate) => Number(candidate?.id) === markId);
  if (!mark) return null;

  return {
    x: Math.round(Number(mark.x) + Number(mark.w) / 2),
    y: Math.round(Number(mark.y) + Number(mark.h) / 2),
    w: Math.round(Number(mark.w)),
    h: Math.round(Number(mark.h)),
    mark,
    coarseMethod: "markId",
  };
}

module.exports = {
  resolveMark,
};
