import { ethers, providers } from 'ethers'
import { MockTrustTokenFactory } from '../build/types/MockTrustTokenFactory'
import { parseEther } from 'ethers/utils'
import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { StakedTokenFactory } from '../build/types/StakedTokenFactory'
import { RegistryImplementationFactory } from '../build/types/RegistryImplementationFactory'

use(solidity)

describe('test test', () => {
  const privateKey = '<insert here>'
  const provider = new providers.InfuraProvider('ropsten', '81447a33c1cd4eb09efb1e8c388fb28e')
  const staker = new ethers.Wallet(privateKey, provider)
  const owner = new ethers.Wallet('<insert here privete key>', provider)
  const ttProxy = MockTrustTokenFactory.connect('0xBe0ca927E02C867c0A4Ff84AF23f15323583a74B', staker)
  const stakeToken = StakedTokenFactory.connect('0x3C4AA6ABA4de96dFc36f4Dd6e182f283a134c9EE', staker)
  const registry = RegistryImplementationFactory.connect('0x08031b53f15f7e5aaddcdf6da3382f8483db4323', owner)

  const BTC1000 = parseEther('1000').div(1e10)
  it('asdasdas', async () => {
    console.log((await ttProxy.balanceOf(stakeToken.address)).toString())
  })
  it('mint money', async () => {
    const balanceBefore = await ttProxy.balanceOf(staker.address)
    await (await ttProxy.faucet(staker.address, BTC1000)).wait()
    expect(await ttProxy.balanceOf(staker.address)).to.eq(BTC1000.add(balanceBefore))
  }).timeout(123123123123123123123)

  it('subscribe', async () => {
    const attribute = '0x697352656769737465726564436f6e7472616374000000000000000000000000'
    await (await registry.subscribe(attribute, ttProxy.address)).wait()
    await (await registry.syncAttribute(attribute, 0, [stakeToken.address])).wait()
  }).timeout(123123123123123123123)

  it('stake', async () => {
    // await (await ttProxy.approve(stakeToken.address, BTC1000)).wait()
    await (await stakeToken.deposit(BTC1000, {gasLimit: 6000000})).wait()
    expect(await stakeToken.balanceOf(staker.address)).to.equal(BTC1000)
  }).timeout(123123123123123123123)
})
