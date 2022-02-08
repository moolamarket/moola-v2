const ganache = require("ganache");

const options = { mnemonic: "fox sight canyon orphan hotel grow hedgehog build bless august weather swarm" };
const server = ganache.server(options);
const PORT = 8545;
server.listen(PORT, async err => {
	  if (err) throw err;

	  console.log(`ganache listening on port ${PORT}...`);
	  const provider = server.provider;
	  const accounts = await provider.request({
		      method: "eth_accounts",
		      params: []
		    });
});
