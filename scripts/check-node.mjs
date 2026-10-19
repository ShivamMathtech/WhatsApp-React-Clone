export function checkNode() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    console.error(
      `This project requires Node.js 24.x. You are running ${process.version}.\nInstall Node.js 24 LTS from https://nodejs.org/ and reopen your terminal.`,
    );
    process.exit(1);
  }
}
checkNode();
