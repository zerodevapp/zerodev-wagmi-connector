import { useAccount, usePrepareContractWrite, useContractWrite, useContractRead, useSigner } from "wagmi";
import TokenArtifact from "./contracts/SampleNFT.json";
import contractAddress from "./contracts/contract-address.json";
import { useEffect } from "react";
import * as zd from "@zerodevapp/sdk";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const generateRandomNumber = (n) => {
  return Math.floor(Math.random() * n)
}

const tokenId = generateRandomNumber(10000000)

// a react component that renders a button
export const Token = () => {
  const { address, isConnected } = useAccount()
  // get signer from wagmi useSigner
  const { data: signer } = useSigner()

  console.log(tokenId)
  const { config } = usePrepareContractWrite({
    addressOrName: contractAddress.NFT,
    contractInterface: TokenArtifact.abi,
    signerOrProvider: signer,
    functionName: "mint",
    args: [address, tokenId],
  })
  const { write: claim, isLoading, isSuccess } = useContractWrite(config)

  const { data: balance, isFetching, refetch } = useContractRead({
    addressOrName: contractAddress.NFT,
    contractInterface: TokenArtifact.abi,
    functionName: 'balanceOf',
    args: [address],
  })

  const onramp = () => {
    zd.onramp({
      signer,
      staging: true,
    })
  }

  const subscribe = async () => {
    await zd.enableModule(signer, '0xF6dBBc0543950C5Ceda3e86fcdC3Babb0E51E624')
  }

  useEffect(() => {
    const fetch = async () => {
      console.log('refetching on success change', isSuccess)
      // sleep for 10 second -- not sure why fetching immediately doesn't work
      await sleep(10000)
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
        {isLoading ? "minting..." : 'mint'}
      </button>
      <button onClick={onramp}>
        onramp
      </button>
      <button onClick={subscribe}>
        subscribe
      </button>
      <button onClick={refetch}>
        refetch
      </button>
    </div>
  );
}
