import { ethers } from 'ethers'
import { OwnedUpgradeabilityProxyFactory } from '../build/types/OwnedUpgradeabilityProxyFactory'
import { LiquidatorResetFactory } from '../build/types/LiquidatorResetFactory'

const resetAssuredFO = async () => {
  const provider = new ethers.providers.InfuraProvider('mainnet', '81447a33c1cd4eb09efb1e8c388fb28e')
  const wallet = new ethers.Wallet(process.argv[2], provider)
  const proxy = OwnedUpgradeabilityProxyFactory.connect('0xa73343a7E918CEECcD2EaA1E4a350089c3b30F89', wallet)
  const reset = LiquidatorResetFactory.connect('0xa73343a7E918CEECcD2EaA1E4a350089c3b30F89', wallet)
  const newImplementation = await (await new LiquidatorResetFactory(wallet).deploy({ gasPrice: 21_000_000_000 })).deployed()
  const oldImplementationAddress = await proxy.implementation()
  await (await proxy.upgradeTo(newImplementation.address, { gasPrice: 21_000_000_000 })).wait()
  await (await reset.resetUniswap({ gasLimit: 6000000, gasPrice: 21_000_000_000 })).wait()
  await (await proxy.upgradeTo(oldImplementationAddress, { gasPrice: 21_000_000_000 })).wait()
}

resetAssuredFO().catch(console.error)
