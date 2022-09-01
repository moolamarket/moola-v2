# auto-repay-borrow-bot

This service can register users properties for autorepaying (if HF < minHF) and borrowing (if HF > maxHF).
Core smart contracts setup for bot:
* LendingPoolAddressesProvider
* AutoRepayAndBorrowAdapter
* MoolaProtocolDataProvider

## How to use
1. Add CELO_BOT_KEY field to .env which is a private key for service transactions execution. The suitable public key should be whitelisted on AutoRepayAndBorrowAdapter contract.
2. To start bot run command: `npm run bot:autorepay`. The bot will check the "HealthFactorSet" event emits on adapter. Then the service will compare the user's data to the user's HF properties. Finally the bot will increace/decreace HF in case of a need using `increaseHealthFactor()`/`decreaceHealthFactor()` on AutoRepayAndBorrowAdapter.

> You can use CLI script to interract with a bot and set min/target/max health factor.
> `node cli network set-auto-repay-params userAddress minHealthFactor targetHealthFactor maxHealthFactor borrow-asset collateral-asset stable|variable`
> Example: `node cli main set-auto-repay-params 0x1234000000000000000000000000000000000000 1.1 1.25 1.4 celo cusd stable`
