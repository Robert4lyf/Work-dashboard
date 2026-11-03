/* projects: no longer in the app (tasks are the titles now). What's already stored about them
   (S.projects, a task's n.project, focus time per project in S.pdaily) is kept, and kept up to
   date, so nothing is lost and copies of the app from before still sync. */
const projectOf = id => {
  const top = id && topOf(id);
  return top ? top.project || '' : '';
};
function addPDaily(d, p, mins) {
  if (!p) return;
  const o = (S.pdaily[d] = S.pdaily[d] || {});
  o[p] = (o[p] || 0) + mins;
}
