import { Wallet, Contract, utils } from 'ethers'
import { MockProvider, deployContract, solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { beforeEachWithFixture } from './utils'

import {
  AssuredFinancialOpportunity,
  ConfigurableFinancialOpportunityMock,
  FractionalExponents,
  SimpleLiquidatorMock,
  MockERC20,
  OwnedUpgradeabilityProxy,
} from '../build'

use(solidity)

const { parseEther } = utils

describe('AssuredFinancialOpportunity', () => {
  let provider: MockProvider

  let token: Contract
  let financialOpportunity: Contract
  let fractionalExponents: Contract
  let liquidator: Contract
  let assuredFinancialOpportunity: Contract

  let wallet: Wallet
  let holder: Wallet
  let beneficiary: Wallet

  const mockPoolAddress = Wallet.createRandom().address

  async function deposit (from: Wallet, value: utils.BigNumberish) {
    await token.connect(from).approve(assuredFinancialOpportunity.address, value)
    await assuredFinancialOpportunity.deposit(from.address, value)
  }

  beforeEachWithFixture(async (p: MockProvider) => {
    (provider = p)

    ; [wallet, holder, beneficiary] = provider.getWallets()

    token = await deployContract(wallet, MockERC20)
    await token.mint(holder.address, parseEther('100'))

    fractionalExponents = await deployContract(wallet, FractionalExponents)
    liquidator = await deployContract(wallet, SimpleLiquidatorMock, [token.address])
    await token.mint(liquidator.address, parseEther('1000'))

    financialOpportunity = await deployContract(wallet, ConfigurableFinancialOpportunityMock, [token.address])
    await token.mint(financialOpportunity.address, parseEther('100'))

    const assuredFinancialOpportunityImpl = await deployContract(wallet, AssuredFinancialOpportunity)
    const assuredFinancialOpportunityProxy = await deployContract(wallet, OwnedUpgradeabilityProxy)
    assuredFinancialOpportunity = assuredFinancialOpportunityImpl.attach(assuredFinancialOpportunityProxy.address)
    await assuredFinancialOpportunityProxy.upgradeTo(assuredFinancialOpportunityImpl.address)
    await assuredFinancialOpportunity.configure(
      financialOpportunity.address,
      mockPoolAddress,
      liquidator.address,
      fractionalExponents.address,
      token.address,
      wallet.address,
    )
  })

  describe('tokenValue', () => {
    it('1.5 tokenValue with 100% reward basis', async function () {
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))
      const finOptokenValue = await financialOpportunity.tokenValue()
      const tokenValue = await assuredFinancialOpportunity.tokenValue()

      expect(tokenValue).to.equal(finOptokenValue)
    })

    it('1.5 tokenValue with 70% reward basis', async function () {
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))
      const tokenValue = await assuredFinancialOpportunity.tokenValue()

      expect(tokenValue).to.equal('1328201239943334173') // 1.5^0.7
    })

    it('adjusted when reward basis changes', async () => {
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))
      const tokenValueBefore = await assuredFinancialOpportunity.tokenValue()
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      const tokenValueAfter = await assuredFinancialOpportunity.tokenValue()

      expect(tokenValueAfter).to.equal(tokenValueBefore)
    })
  })

  describe('deposit', async function () {
    it('with exchange rate = 1', async function () {
      await deposit(holder, parseEther('10'))
      const finOpBalance = await assuredFinancialOpportunity.totalSupply()
      const remaingTokenBalance = await token.balanceOf(holder.address)

      expect(finOpBalance).to.equal(parseEther('10'))
      expect(remaingTokenBalance).to.equal(parseEther('90'))
    })

    it('with exchange rate = 1.5', async function () {
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))
      await deposit(holder, parseEther('15'))
      const finOpBalance = await assuredFinancialOpportunity.totalSupply()
      const remaingTokenBalance = await token.balanceOf(holder.address)

      expect(finOpBalance).to.equal(parseEther('10'))
      expect(remaingTokenBalance).to.equal(parseEther('85'))
    })

    it('only funds manager can call', async function () {
      expect(
        assuredFinancialOpportunity.connect(holder).deposit(holder.address, parseEther('10')),
      ).to.be.reverted
    })

    it('two deposits in a row', async function () {
      await deposit(holder, parseEther('15'))

      await financialOpportunity.increaseTokenValue(parseEther('1'))

      await token.connect(holder).approve(assuredFinancialOpportunity.address, parseEther('10'))
      await assuredFinancialOpportunity.deposit(holder.address, parseEther('10'))

      expect(await assuredFinancialOpportunity.totalSupply()).to.equal(parseEther('20'))
    })
  })

  describe('withdraw', async function () {
    beforeEach(async function () {
      await deposit(holder, parseEther('10'))
    })

    it('redeem', async function () {
      await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('5'))
      const remaingHoldersTokenBalance = await token.balanceOf(holder.address)
      const newBeneficiarysTokenBalance = await token.balanceOf(beneficiary.address)
      const finOpBalance = await assuredFinancialOpportunity.totalSupply()

      expect(remaingHoldersTokenBalance).to.equal(parseEther('90'))
      expect(newBeneficiarysTokenBalance).to.equal(parseEther('5'))
      expect(finOpBalance).to.equal(parseEther('5'))
    })

    it('only funds manager can call redeem', async function () {
      expect(
        assuredFinancialOpportunity.connect(holder).redeem(beneficiary.address, parseEther('5')),
      ).to.be.reverted
      expect(
        assuredFinancialOpportunity.connect(beneficiary).redeem(beneficiary.address, parseEther('5')),
      ).to.be.reverted
    })

    describe('with exchange rate = 1.5', async function () {
      const checkBalances = async () => ({
        newBeneficiarysTokenBalance: await token.balanceOf(beneficiary.address),
        financialOpportunityBalance: await assuredFinancialOpportunity.totalSupply(),
      })

      beforeEach(async function () {
        await financialOpportunity.increaseTokenValue(parseEther('0.5'))

        expect(await assuredFinancialOpportunity.tokenValue()).to.equal(parseEther('1.5'))
        expect(await assuredFinancialOpportunity.totalSupply()).to.equal(parseEther('10'))
      })

      it('can redeem 100%', async function () {
        await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('10'))
        const { newBeneficiarysTokenBalance, financialOpportunityBalance } = await checkBalances()

        expect(newBeneficiarysTokenBalance).to.equal(parseEther('15'))
        expect(financialOpportunityBalance).to.equal('0')
      })

      it('can redeem 50%', async function () {
        await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('5'))

        const { newBeneficiarysTokenBalance, financialOpportunityBalance } = await checkBalances()
        expect(newBeneficiarysTokenBalance).to.equal(parseEther('7.5'))
        expect(financialOpportunityBalance).to.equal(parseEther('5'))
      })

      it('can withdraw twice in a row', async () => {
        await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('1'))
        await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('2'))

        const { newBeneficiarysTokenBalance, financialOpportunityBalance } = await checkBalances()
        expect(newBeneficiarysTokenBalance).to.equal(parseEther('4.5'))
        expect(financialOpportunityBalance).to.equal(parseEther('7'))
      })
    })
  })

  it('liquidation', async () => {
    await deposit(holder, parseEther('10'))
    await financialOpportunity.increaseTokenValue(parseEther('19'))

    await assuredFinancialOpportunity.redeem(beneficiary.address, parseEther('12'))

    expect(await token.balanceOf(beneficiary.address)).to.equal(parseEther('240'))
    expect(await assuredFinancialOpportunity.totalSupply()).to.equal(parseEther('10'))
  })

  describe('poolAwardBalance', () => {
    it('0 when reward basis is 100%', async () => {
      await deposit(holder, parseEther('10'))
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      expect(await assuredFinancialOpportunity.poolAwardBalance()).to.eq(0)
    })

    it('properly calculated when reward basis is 70%', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))
      // 10 * (1.5 - 1.5 ^ 0.7) = 1717987600566658261 - 9 wei error
      expect(await assuredFinancialOpportunity.poolAwardBalance()).to.equal('1717987600566658270')
    })
  })

  describe('award pool', () => {
    it('awards 0 when reward basis is 100%', async () => {
      await deposit(holder, parseEther('10'))
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      await assuredFinancialOpportunity.awardPool()

      expect(await token.balanceOf(mockPoolAddress)).to.equal(0)
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10'))
    })

    it('awards proper amount', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      const expectedAward = '1717987600566658269' // 10 * (1.5 - 1.5 ^ 0.7)
      await expect(assuredFinancialOpportunity.awardPool()).to.emit(assuredFinancialOpportunity, 'AwardPool').withArgs(expectedAward)

      expect(await token.balanceOf(mockPoolAddress)).to.equal(expectedAward)
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10').sub('1145325067044438846')) // 10 * (1.5 - 1.5 ^ 0.7) / 1.5
    })

    it('awards 0 on subsequent calls', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      await assuredFinancialOpportunity.awardPool()

      // 1 wei left due to rounding errors
      expect(await assuredFinancialOpportunity.poolAwardBalance()).to.equal(1)
      await assuredFinancialOpportunity.awardPool()
      expect(await token.balanceOf(mockPoolAddress)).to.equal('1717987600566658269')
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10').sub('1145325067044438846'))
    })

    it('awards proper amount when per token value increases between calls', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      const firstTUsdAmount = '1717987600566658269' // 10 * (1.5 - 1.5 ^ 0.7)
      const secondTUsdAmount = '3145242509079556025' // 10 * (2.5 - 2.5 ^ 0.7) - firstTUsdAmount

      await expect(assuredFinancialOpportunity.awardPool()).to.emit(assuredFinancialOpportunity, 'AwardPool').withArgs(firstTUsdAmount)
      await financialOpportunity.increaseTokenValue(parseEther('1'))
      await expect(assuredFinancialOpportunity.awardPool()).to.emit(assuredFinancialOpportunity, 'AwardPool').withArgs(secondTUsdAmount)

      // 1 wei error
      expect(await token.balanceOf(mockPoolAddress)).to.equal('4863230109646214294') // firstTUsdAmount + secondTUsdAmount
      expect(await financialOpportunity.totalSupply()).to.equal('7596577929323738744') // 10 - firstTUsdAmount - secondTUsdAmount
    })

    it('not additional awards when reward basis changes between calls', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      await assuredFinancialOpportunity.awardPool()
      await assuredFinancialOpportunity.setRewardBasis(0.5 * 1000)

      // 1 wei error
      expect(await assuredFinancialOpportunity.poolAwardBalance()).to.equal(1)
      await assuredFinancialOpportunity.awardPool()

      // 1 wei error
      expect(await token.balanceOf(mockPoolAddress)).to.equal('1717987600566658269')
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10').sub('1145325067044438846'))
    })

    it('does NOT revert if the withdrawal fails', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('99'))

      await assuredFinancialOpportunity.awardPool()

      expect(await token.balanceOf(mockPoolAddress)).to.equal(0)
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10'))
    })

    it('anyone can call', async () => {
      await deposit(holder, parseEther('10'))
      await assuredFinancialOpportunity.setRewardBasis(0.7 * 1000)
      await financialOpportunity.increaseTokenValue(parseEther('0.5'))

      await assuredFinancialOpportunity.connect(holder).awardPool()

      expect(await token.balanceOf(mockPoolAddress)).to.equal('1717987600566658269')
      expect(await financialOpportunity.totalSupply()).to.equal(parseEther('10').sub('1145325067044438846'))
    })
  })
})
