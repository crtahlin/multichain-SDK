import { Execute, ProgressData, RelayClient } from '@relayprotocol/relay-sdk'
import { MultichainLibrary } from '@upcoming/multichain-library'
import { FixedPointNumber } from 'cafe-utility'
import { WalletClient } from 'viem'
import { getExplorerTxUrl } from '../config'

export type SendTransactionSignature = (tx: { to: `0x${string}`; value: bigint }) => Promise<`0x${string}`>

interface Options {
  library: MultichainLibrary
  sourceChain: number
  sourceToken: string
  temporaryAddress: `0x${string}`
  sourceTokenAmount: FixedPointNumber
  sendTransactionAsync: SendTransactionSignature
  relayClient: RelayClient
  walletClient: WalletClient
  relayQuote: Execute
  totalDaiValue: FixedPointNumber
  onMetadata: (key: string, value: string) => void
}

export function createRelayStep(options: Options) {
  return {
    name: 'relay',
    precondition: async () => {
      const dai = await options.library.getGnosisNativeBalance(options.temporaryAddress)
      return dai.value < options.totalDaiValue.value
    },
    action: async (context: Map<string, unknown>) => {
      const daiBefore = await options.library.getGnosisNativeBalance(options.temporaryAddress)
      context.set('daiBefore', daiBefore)
      if (
        options.sourceToken === options.library.constants.nullAddress &&
        options.sourceChain === options.library.constants.gnosisChainId
      ) {
        const tx = await options.sendTransactionAsync({
          to: options.temporaryAddress,
          value: options.sourceTokenAmount.value,
        })
        options.onMetadata('relay', `https://gnosisscan.io/tx/${tx}`)
      } else {
        await options.relayClient.actions.execute({
          quote: options.relayQuote,
          wallet: options.walletClient,
          onProgress: (data: ProgressData) => {
            console.log('Relay progress data', data)
            if (data.txHashes) {
              const txHash = data.txHashes.find(x => x.txHash.length >= 64)
              if (txHash) {
                options.onMetadata('relay', getExplorerTxUrl(txHash.chainId, txHash.txHash))
              }
            }
          },
        })
      }
    },
  }
}
