import { ethers } from 'ethers'
import { OwnedUpgradeabilityProxyFactory } from '../build/types/OwnedUpgradeabilityProxyFactory'
import { LiquidatorResetFactory } from '../build/types/LiquidatorResetFactory'

const resetAssuredFO = async () => {
  const provider = new ethers.providers.InfuraProvider('mainnet', '81447a33c1cd4eb09efb1e8c388fb28e')
  const wallet = new ethers.Wallet(process.argv[2], provider)
  const proxy = OwnedUpgradeabilityProxyFactory.connect('0x1dfB7700E67e6046898c2FEfe160FB53fEC3A27c', wallet)
  const reset = LiquidatorResetFactory.connect('0x1dfB7700E67e6046898c2FEfe160FB53fEC3A27c', wallet)
  const newImplementation = await (await new LiquidatorResetFactory(wallet).deploy()).deployed()
  const oldImplementationAddress = await proxy.implementation()
  await (await proxy.upgradeTo(newImplementation.address)).wait()
  await (await reset.resetUniswap({ gasLimit: 6000000, gasPrice: 21_000_000_000 })).wait()
  await (await proxy.upgradeTo(oldImplementationAddress)).wait()
}

resetAssuredFO().catch(console.error)
