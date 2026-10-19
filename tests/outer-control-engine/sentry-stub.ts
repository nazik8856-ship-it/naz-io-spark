export const init = () => {}; export const captureMessage = () => {}; export const captureException = () => {}; export const withScope = (f: any) => f({ setTag() {}, setExtra() {}, setLevel() {} }); export const flush = async () => true;
export default { init, captureMessage, captureException, withScope, flush };
