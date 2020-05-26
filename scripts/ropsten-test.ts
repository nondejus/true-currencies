import { Contract, ethers, providers } from 'ethers'
import { MockTrustTokenFactory } from '../build/types/MockTrustTokenFactory'
import { BigNumber, formatEther, parseEther } from 'ethers/utils'
import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { StakedTokenFactory } from '../build/types/StakedTokenFactory'
import { RegistryImplementationFactory } from '../build/types/RegistryImplementationFactory'
import { attributes } from './registry'
import { RegistryImplementation } from '../build/types/RegistryImplementation'
import { AaveFinancialOpportunityFactory } from '../build/types/AaveFinancialOpportunityFactory'
import { AssuredFinancialOpportunityFactory } from '../build/types/AssuredFinancialOpportunityFactory'
import { Zero } from 'ethers/constants'

use(solidity)
const REGISTRY_DEPLOYMENT_BLOCK = 7901430

describe('test test', function () {
  this.timeout(10000000)
  const stakerPrivateKey = '<staker private key>'
  const provider = new providers.InfuraProvider('ropsten', '81447a33c1cd4eb09efb1e8c388fb28e')
  const staker = new ethers.Wallet(stakerPrivateKey, provider)
  const owner = new ethers.Wallet('<owner private key>', provider)
  const trustToken = MockTrustTokenFactory.connect('0xBe0ca927E02C867c0A4Ff84AF23f15323583a74B', staker)
  const stakeToken = StakedTokenFactory.connect('0x3C4AA6ABA4de96dFc36f4Dd6e182f283a134c9EE', staker)
  const registry = RegistryImplementationFactory.connect('0x08031b53f15f7e5aaddcdf6da3382f8483db4323', owner)
  const aaveFinOp = AaveFinancialOpportunityFactory.connect('0x6027ec14d0a9eb688b6b4f169992c8644ef48163', owner)
  const assuredFinOp = AssuredFinancialOpportunityFactory.connect('0xe7a0c1148a0360d608b6de61ef243a96a14efb75', owner)

  const BTC1000 = parseEther('1000').div(1e10)
  it('asdasdas', async () => {
    console.log((await trustToken.balanceOf(stakeToken.address)).toString())
  })

  it('mint trust tokens for staker', async () => {
    const balanceBefore = await trustToken.balanceOf(staker.address)
    await (await trustToken.faucet(staker.address, BTC1000)).wait()
    expect(await trustToken.balanceOf(staker.address)).to.eq(BTC1000.add(balanceBefore))
  })

  it('subscribe', async () => {
    const attribute = '0x697352656769737465726564436f6e7472616374000000000000000000000000'
    await (await registry.subscribe(attribute, trustToken.address)).wait()
    await (await registry.ibute(attribute, 0, [stakeToken.address])).wait()
  })

  async function isSubscriber (registry: RegistryImplementation, attribute: string, subscriber: Contract) {
    const topics = registry.filters.StartSubscription(attribute, subscriber.address).topics
    await registry.deployed()
    const logs = await provider.getLogs({
      fromBlock: REGISTRY_DEPLOYMENT_BLOCK,
      toBlock: await provider.getBlockNumber(),
      topics,
      address: registry.address,
    })
    expect(logs).to.have.length.at.least(1)
  }

  async function checkState () {
    await isSubscriber(registry, attributes.isRegisteredContract, trustToken)
    expect(await registry.getAttributeValue(stakeToken.address, attributes.isRegisteredContract)).to.eq(1)
  }

  it('stake', async () => {
    await checkState()
    expect(await trustToken.balanceOf(stakeToken.address)).to.eq(0)
    expect(await stakeToken.totalSupply()).to.eq(0)
    expect(await stakeToken.balanceOf(staker.address)).to.equal(0)
    await (await trustToken.approve(stakeToken.address, BTC1000)).wait()
    await (await stakeToken.deposit(BTC1000, { gasLimit: 6000000 })).wait()
    expect(await stakeToken.balanceOf(staker.address)).to.equal(BTC1000.mul(1000))
  })

  it('sum deposits to configurable op', async () => {
    const topics = assuredFinOp.filters.Deposit(null, null, null).topics
    const logs = await provider.getLogs({ fromBlock: 7901512, toBlock: 7926271, address: assuredFinOp.address, topics })
    const sumOfDepositsToConfigurableFinOp = logs
      .map((log) => assuredFinOp.interface.events.Deposit.decode(log.data)['ztusd'])
      .reduce((sum:BigNumber, current:BigNumber) => sum.add(current), Zero)
    console.log(`sumOfDepositsToConfigurableFinOp = ${sumOfDepositsToConfigurableFinOp}`)
  })

  it('produces rewards', async () => {
    // function poolAwardBalance() public view returns (uint256) {
    //   uint256 zTUSDValue = finOp().tokenValue().mul(finOp().totalSupply()).div(10**18);
    //   uint256 yTUSDValue = _totalSupply().mul(_tokenValue()).div(10**18);
    //   return zTUSDValue.sub(yTUSDValue);
    // }

    const aaveTokenValue = await aaveFinOp.tokenValue()
    const aaveTotalSupply = await aaveFinOp.totalSupply()
    const aave = aaveTokenValue.mul(aaveTotalSupply)
    console.log(`${aaveTokenValue} * ${aaveTotalSupply} = ${aave}`)
    const assuredTotalSupply = (await assuredFinOp.totalSupply())// .sub('925242424242424241728')
    const assuredTokenValue = await assuredFinOp.tokenValue()
    const assured = assuredTokenValue.mul(assuredTotalSupply)
    console.log(`${assuredTokenValue} * ${assuredTotalSupply} = ${assured}`)
    console.log(`${formatEther(aave.sub(assured))}`)
  })
  /*
1001419294354063739 * 2001816435289982891635 = 2004657602054461964483623097548319923265
1268113052019478187 * 2077671222831092640961 = 2634721995477378238026616614846962217707
-630064393422916273542993517298642294442
   */

  it('setups liquidator', async () => {
    await (await registry.subscribe(attributes.approvedBeneficiary, '0x93b3961749580b328d395f5fdfbae426135c0a15')).wait()
    await (await registry.setAttributeValue(assuredFinOp.address, attributes.approvedBeneficiary, 1)).wait()
  })
})
