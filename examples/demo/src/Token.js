import { useAccount, usePrepareContractWrite, useContractWrite, useContractRead, useSigner } from "wagmi";
import TokenArtifact from "./contracts/Token.json";
import contractAddress from "./contracts/contract-address.json";
import { useEffect } from "react";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// a react component that renders a button
export const Token = () => {
  const { address, isConnected } = useAccount()
  // get signer from wagmi useSigner
  const { data: signer } = useSigner()

  const { config } = usePrepareContractWrite({
    addressOrName: contractAddress.Token,
    contractInterface: TokenArtifact.abi,
    signerOrProvider: signer,
    functionName: "claim",
    args: [100],
  })
  const { write: claim, isLoading, isSuccess } = useContractWrite(config)

  const { data: balance, isFetching, refetch } = useContractRead({
    addressOrName: contractAddress.Token,
    contractInterface: TokenArtifact.abi,
    functionName: 'balanceOf',
    args: [address],
  })

  useEffect(() => {
    const fetch = async () => {
      console.log('refetching on success change', isSuccess)
      // sleep for 1 second -- not sure why fetching immediately doesn't work
      await sleep(1000)
      refetch()
    }
    fetch()
  }, [isSuccess])

  return (
    isConnected &&
    <div>
      <div>
        balance: {isFetching ? 'fetching...' : balance?.toString()}
      </div>
      <button disabled={!claim || isLoading} onClick={() => claim?.()}>
        {isLoading ? "claiming..." : 'claim'}
      </button>
    </div>
  );
}
