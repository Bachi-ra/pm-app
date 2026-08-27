// Express 4はasyncハンドラ内で発生した例外/rejectionを自動catchしないため、
// 素通りするとプロセス全体がクラッシュする(unhandled promise rejection)。
// 必ずこれで包み、next(err)経由でエラーハンドラに渡す。
module.exports = function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
