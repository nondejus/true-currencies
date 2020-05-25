import { ethers } from 'ethers'
import { OwnedUpgradeabilityProxyFactory } from '../build/types/OwnedUpgradeabilityProxyFactory'
import { ResetFactory } from '../build/types/ResetFactory'

const resetAssuredFO = async () => {
  const provider = new ethers.providers.InfuraProvider('ropsten', '81447a33c1cd4eb09efb1e8c388fb28e')
  const wallet = new ethers.Wallet('<owner private key>', provider)
  const proxy = OwnedUpgradeabilityProxyFactory.connect('0xbe0ca927e02c867c0a4ff84af23f15323583a74b', wallet)
  const reset = ResetFactory.connect('0xbe0ca927e02c867c0a4ff84af23f15323583a74b', wallet)
  const newImplementation = await (await new ResetFactory(wallet).deploy()).deployed()
  const oldImplementationAddress = '0x3C60B01c034193D621D06F0055a67415e1143C1E'
  await (await proxy.upgradeTo(newImplementation.address)).wait()
  await (await reset.claimOwnership({ gasLimit: 6000000 })).wait()
  await (await reset.burn({ gasLimit: 6000000 })).wait()
  await (await proxy.upgradeTo(oldImplementationAddress)).wait()
}

resetAssuredFO().catch(console.error)
