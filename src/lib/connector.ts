import { Chain, Connector, ConnectorData, normalizeChainId, UserRejectedRequestError } from "@wagmi/core";
import {
  ADAPTER_EVENTS,
  ADAPTER_STATUS,
  CHAIN_NAMESPACES,
  CustomChainConfig,
  getChainConfig,
  WALLET_ADAPTER_TYPE,
  WALLET_ADAPTERS,
} from "@web3auth/base";
import { Web3AuthCore } from "@web3auth/core";
import { OpenloginAdapter } from "@web3auth/openlogin-adapter";
import LoginModal, { getAdapterSocialLogins, LOGIN_MODAL_EVENTS, OPENLOGIN_PROVIDERS } from "@web3auth/ui";
import * as zd from "@zerodevapp/sdk";
import { Signer } from "ethers";
import { getAddress } from "ethers/lib/utils";
import log from "loglevel";

import { Options } from "./interfaces";

const IS_SERVER = typeof window === "undefined";

export class Web3AuthConnector extends Connector {
  ready = !IS_SERVER;

  readonly id = "web3Auth";

  readonly name = "web3Auth";

  provider: zd.ERC4337EthersProvider;

  web3AuthInstance?: Web3AuthCore;

  isModalOpen = false;

  web3AuthOptions: Options;

  private loginModal: LoginModal;

  private socialLoginAdapter: OpenloginAdapter;

  constructor(config: { chains?: Chain[]; options: Options }) {
    super(config);
    this.web3AuthOptions = config.options;
    console.log("constructor config", config)
    const chainId = config.options.chainId ? parseInt(config.options.chainId, 16) : 1;
    console.log("constructor chainId", chainId)
    const chainConfig = this.chains.filter((x) => x.id === chainId);

    const defaultChainConfig = getChainConfig(CHAIN_NAMESPACES.EIP155, config.options.chainId || "0x1");
    let finalChainConfig: CustomChainConfig = {
      chainNamespace: CHAIN_NAMESPACES.EIP155,
      ...defaultChainConfig,
    };
    if (chainConfig.length > 0) {
      let currentChain = chainConfig[0];
      if (config.options.chainId) {
        currentChain = chainConfig.find((chain) => chain.id === normalizeChainId(config.options.chainId));
      }
      finalChainConfig = {
        ...finalChainConfig,
        chainNamespace: CHAIN_NAMESPACES.EIP155,
        chainId: `0x${currentChain.id.toString(16)}`,
        rpcTarget: currentChain.rpcUrls.default,
        displayName: currentChain.name,
        tickerName: currentChain.nativeCurrency?.name,
        ticker: currentChain.nativeCurrency?.symbol,
        blockExplorer: currentChain?.blockExplorers.default?.url,
      };
    }
    this.web3AuthInstance = new Web3AuthCore({
      clientId: config.options.clientId,
      enableLogging: config.options.enableLogging,
      storageKey: config.options.storageKey,
      chainConfig: {
        chainNamespace: CHAIN_NAMESPACES.EIP155,
        ...finalChainConfig,
      },
    });

    this.socialLoginAdapter = new OpenloginAdapter({
      adapterSettings: {
        ...config.options,
      },
      loginSettings: {
        ...(config.options?.socialLoginConfig || {}),
      },
      chainConfig: finalChainConfig,
    });

    this.web3AuthInstance.configureAdapter(this.socialLoginAdapter);

    this.loginModal = new LoginModal({
      theme: this.options.uiConfig?.theme,
      appLogo: this.options.uiConfig?.appLogo || "",
      version: "",
      adapterListener: this.web3AuthInstance,
      displayErrorsOnModal: this.options.displayErrorsOnModal,
    });

    this.subscribeToLoginModalEvents();
  }

  async connect(): Promise<Required<ConnectorData>> {
    console.log("connect")
    try {
      this.emit("message", {
        type: "connecting",
      });

      await this.loginModal.initModal();

      this.loginModal.addSocialLogins(
        WALLET_ADAPTERS.OPENLOGIN,
        getAdapterSocialLogins(WALLET_ADAPTERS.OPENLOGIN, this.socialLoginAdapter, this.options.uiConfig?.loginMethodConfig),
        this.options.uiConfig?.loginMethodsOrder || OPENLOGIN_PROVIDERS
      );
      if (this.web3AuthInstance.status !== ADAPTER_STATUS.READY) {
        await this.web3AuthInstance.init();
      }

      // Check if there is a user logged in
      const isLoggedIn = await this.isAuthorized();

      // if there is a user logged in, return the user
      if (isLoggedIn) {
        const provider = await this.getProvider();
        const chainId = await this.getChainId();
        if (provider.on) {
          provider.on("accountsChanged", this.onAccountsChanged.bind(this));
          provider.on("chainChanged", this.onChainChanged.bind(this));
        }
        const unsupported = this.isChainUnsupported(chainId);

        return {
          provider,
          chain: {
            id: chainId,
            unsupported,
          },
          account: await this.getAccount(),
        };
      }

      this.loginModal.open();
      const elem = document.getElementById("w3a-container");
      elem.style.zIndex = "10000000000";
      return await new Promise((resolve, reject) => {
        this.loginModal.once(LOGIN_MODAL_EVENTS.MODAL_VISIBILITY, (isVisible: boolean) => {
          if (!isVisible && !this.web3AuthInstance.provider) {
            return reject(new Error("User closed popup"));
          }
        });
        this.web3AuthInstance.once(ADAPTER_EVENTS.CONNECTED, async () => {
          const signer = await this.getSigner();
          const account = await signer.getAddress();
          const provider = await this.getProvider();

          if (provider.on) {
            provider.on("accountsChanged", this.onAccountsChanged.bind(this));
            provider.on("chainChanged", this.onChainChanged.bind(this));
          }
          const chainId = await this.getChainId();
          const unsupported = this.isChainUnsupported(chainId);

          return resolve({
            account,
            chain: {
              id: chainId,
              unsupported,
            },
            provider,
          });
        });
        this.web3AuthInstance.once(ADAPTER_EVENTS.ERRORED, (err: unknown) => {
          log.error("error while connecting", err);
          return reject(err);
        });
      });
    } catch (error) {
      log.error("error while connecting", error);
      throw new UserRejectedRequestError("Something went wrong");
    }
  }

  async getAccount(): Promise<string> {
    console.log("getAccount")
    const signer = await this.getSigner();
    const account = await signer.getAddress();
    return account;
  }

  async getProvider() {
    console.log("getProvider")
    if (this.provider) {
      return this.provider;
    }
    console.log('web3auth provider', this.web3AuthInstance.provider)
    this.provider = await zd.getProvider({
      projectId: "b5486fa4-e3d9-450b-8428-646e757c10f6",
      web3Provider: this.web3AuthInstance.provider,
    });
    return this.provider;
  }

  async getSigner(): Promise<Signer> {
    console.log("getSigner")
    const provider = await this.getProvider();
    const signer = provider.getSigner();
    return signer;
  }

  async isAuthorized() {
    console.log("isAuthorized")
    try {
      const account = await this.getAccount();
      return !!(account && this.provider);
    } catch {
      return false;
    }
  }

  async getChainId(): Promise<number> {
    console.log("getChainId")
    try {
      if (!this.web3AuthInstance.provider) {
        const networkOptions = this.socialLoginAdapter.chainConfigProxy;
        if (typeof networkOptions === "object") {
          const chainID = networkOptions.chainId;
          if (chainID) {
            return normalizeChainId(chainID);
          }
        }
      } else {
        const provider = await this.getProvider();
        const chainId = provider.chainId;
        console.log("chainId", chainId)
        if (chainId) {
          return normalizeChainId(chainId);
        }
      }
      throw new Error("Chain ID is not defined");
    } catch (error) {
      log.error("error", error);
      throw error;
    }
  }

  async switchChain(chainId: number) {
    console.log("switchChain")
    try {
      const chain = this.chains.find((x) => x.id === chainId);
      if (!chain) throw new Error(`Unsupported chainId: ${chainId}`);
      const provider = this.getProvider();
      if (!provider) throw new Error("Please login first");
      // eslint-disable-next-line no-console
      console.log("chain", chain);
      this.provider.perform("wallet_addEthereumChain", [
        {
          chainId: `0x${chain.id.toString(16)}`,
          chainName: chain.name,
          rpcUrls: [chain.rpcUrls.default],
          blockExplorerUrls: [chain.blockExplorers?.default?.url],
          nativeCurrency: {
            symbol: chain.nativeCurrency?.symbol || "ETH",
          },
        },
      ]);
      await this.provider.perform("wallet_switchEthereumChain", [
        {
          chainId: `0x${chain.id.toString(16)}`,
        },
      ]);
      return chain;
    } catch (error) {
      log.error("Error: Cannot change chain", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    console.log("disconnect")
    await this.web3AuthInstance.logout();
    this.provider = null;
  }

  protected onAccountsChanged(accounts: string[]): void {
    console.log("onAccountsChanged")
    if (accounts.length === 0) this.emit("disconnect");
    else this.emit("change", { account: getAddress(accounts[0]) });
  }

  protected isChainUnsupported(chainId: number): boolean {
    console.log("isChainUnsupported")
    return !this.chains.some((x) => x.id === chainId);
  }

  protected onChainChanged(chainId: string | number): void {
    console.log("onChainChanged")
    const id = normalizeChainId(chainId);
    const unsupported = this.isChainUnsupported(id);
    this.emit("change", { chain: { id, unsupported } });
  }

  protected onDisconnect(): void {
    console.log("onDisconnect")
    this.emit("disconnect");
  }

  private subscribeToLoginModalEvents(): void {
    console.log("subscribeToLoginModalEvents")
    this.loginModal.on(LOGIN_MODAL_EVENTS.LOGIN, async (params: { adapter: WALLET_ADAPTER_TYPE; loginParams: unknown }) => {
      try {
        await this.web3AuthInstance.connectTo<unknown>(params.adapter, params.loginParams);
      } catch (error) {
        log.error(`Error while connecting to adapter: ${params.adapter}`, error);
      }
    });

    this.loginModal.on(LOGIN_MODAL_EVENTS.DISCONNECT, async () => {
      try {
        await this.disconnect();
      } catch (error) {
        log.error(`Error while disconnecting`, error);
      }
    });
  }
}
