import { ethers } from 'ethers'
import { OwnedUpgradeabilityProxyFactory } from '../build/types/OwnedUpgradeabilityProxyFactory'
import { AssuredFinancialOpportunityResetFactory } from '../build/types/AssuredFinancialOpportunityResetFactory'

const resetAssuredFO = async () => {
  const provider = new ethers.providers.InfuraProvider('ropsten', '81447a33c1cd4eb09efb1e8c388fb28e')
  const wallet = new ethers.Wallet('0x2F4E984196CCE414D059C91230917F10F3067F3F8E7DAF6C0B0933C13F9AF8FA', provider)
  const proxy = OwnedUpgradeabilityProxyFactory.connect('0xe7a0C1148A0360D608b6DE61Ef243A96a14eFB75', wallet)
  const assuredFO = AssuredFinancialOpportunityResetFactory.connect('0xe7a0C1148A0360D608b6DE61Ef243A96a14eFB75', wallet)
  const newImplementation = await (await new AssuredFinancialOpportunityResetFactory(wallet).deploy()).deployed()
  const oldImplementationAddress = await proxy.implementation()
  await (await proxy.upgradeTo(newImplementation.address)).wait()
  await (await assuredFO.reset()).wait()
  await (await proxy.upgradeTo(oldImplementationAddress)).wait()
}

resetAssuredFO().catch(console.error)
