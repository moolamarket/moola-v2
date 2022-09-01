# auto-repay-borrow-bot

1. Add CELO_BOT_KEY field to .env which is a private key for service transactions execution. The suitable public key should be whitelisted on AutoRepayAndBorrowAdapter contract.
2. To start bot run command: `npm run bot:autorepay`.
> You can use CLI script to interract with a bot and set min/target/max health factor.
> `set-auto-repay-params address minHealthFactor targetHealthFactor maxHealthFactor borrow-asset collateral-asset stable|variable [privateKey]`