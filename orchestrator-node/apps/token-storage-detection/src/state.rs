use crate::{config::DEFAULT_TIMEOUT_MS, db::RedisConnection};
use alloy::{providers::Provider, transports::Transport};
use std::{
    collections::HashMap,
    hash::Hash,
    str::FromStr,
    sync::{Arc, Mutex},
};
use strum::EnumIter;

#[derive(Clone)]
pub struct AppState<P, T, H>
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    pub providers: Arc<HashMap<Chain, AppProvider<P, T, H>>>,
    pub db_connection: Option<Arc<Mutex<RedisConnection>>>,
    pub timeout_ms: u64,
}

impl<P, T, H> AppState<P, T, H>
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    pub fn new(
        providers: HashMap<Chain, AppProvider<P, T, H>>,
        db_connection: Option<RedisConnection>,
        timeout_ms: u64,
    ) -> Self {
        Self {
            providers: Arc::new(providers),
            db_connection: db_connection.map(|conn| Arc::new(Mutex::new(conn))),
            timeout_ms,
        }
    }
}

pub struct AppProviders<P, T, H>(HashMap<Chain, AppProvider<P, T, H>>)
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static;

impl<P, T, H> AppProviders<P, T, H>
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    pub fn new() -> Self {
        Self(HashMap::new())
    }

    pub fn set_provider(
        &mut self,
        chain: Chain,
        provider: P,
        local_tracing: bool,
        handler: Option<H>,
    ) {
        self.0.insert(
            chain,
            AppProvider {
                provider: Arc::new(provider),
                _handler: handler,
                local_tracing,
                _phantom_transport: std::marker::PhantomData,
            },
        );
    }

    pub fn build(self) -> HashMap<Chain, AppProvider<P, T, H>> {
        self.0
    }
}

impl<P, T, H> From<AppProviders<P, T, H>> for AppState<P, T, H>
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    fn from(providers: AppProviders<P, T, H>) -> Self {
        Self {
            providers: Arc::new(providers.build()),
            timeout_ms: DEFAULT_TIMEOUT_MS,
            db_connection: None,
        }
    }
}

pub struct AppProvider<P, T, H>
where
    P: Provider<T>,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    pub provider: Arc<P>,
    pub local_tracing: bool,
    _handler: Option<H>, // Handler for cases like Anvil
    _phantom_transport: std::marker::PhantomData<T>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, EnumIter)]
pub enum Chain {
    // Mainnets
    Ethereum,
    Base,
    Polygon,
    Arbitrum,
    Optimism,
    Bsc,
    Sonic,
    Scroll,
    Gnosis,
    Avalanche,
    Apechain,
    HyperEVM,
    Sei,
    Unichain,
    Katana,
    Lisk,
    Worldchain,
    Monad,
    Plasma,
    Chiliz,
    Megaeth,
    Moca,
    // Testnets
    MonadTestnet,
    PlasmaTestnet,
    ChilizSpicy,
    EthereumSepolia,
    BaseSepolia,
    PolygonAmoy,
    ArbitrumSepolia,
    OptimismSepolia,
    BscTestnet,
    SonicBlaze,
    SonicTestnet,
    ScrollSepolia,
    GnosisChiado,
    AvalancheFuji,
    ApechainCurtis,
    NeuraTestnet,
    SeiTestnet,
    UnichainTestnet,
    WorldchainTestnet,
    FluentTestnet,
    ArcTestnet,
    AvaxTestnet,
    MegaethTestnet,
    MocaTestnet,
}

impl FromStr for Chain {
    type Err = eyre::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            // Mainnets
            "1" => Ok(Chain::Ethereum),
            "8453" => Ok(Chain::Base),
            "137" => Ok(Chain::Polygon),
            "42161" => Ok(Chain::Arbitrum),
            "10" => Ok(Chain::Optimism),
            "56" => Ok(Chain::Bsc),
            "146" => Ok(Chain::Sonic),
            "534352" => Ok(Chain::Scroll),
            "100" => Ok(Chain::Gnosis),
            "43114" => Ok(Chain::Avalanche),
            "33139" => Ok(Chain::Apechain),
            "999" => Ok(Chain::HyperEVM),
            "1329" => Ok(Chain::Sei),
            "130" => Ok(Chain::Unichain),
            "747474" => Ok(Chain::Katana),
            "1135" => Ok(Chain::Lisk),
            "480" => Ok(Chain::Worldchain),
            "143" => Ok(Chain::Monad),
            "9745" => Ok(Chain::Plasma),
            "88888" => Ok(Chain::Chiliz),
            "4326" => Ok(Chain::Megaeth),
            "2288" => Ok(Chain::Moca),
            // Testnets
            "9746" => Ok(Chain::PlasmaTestnet),
            "10143" => Ok(Chain::MonadTestnet),
            "88882" => Ok(Chain::ChilizSpicy),
            "11155111" => Ok(Chain::EthereumSepolia),
            "84532" => Ok(Chain::BaseSepolia),
            "80002" => Ok(Chain::PolygonAmoy),
            "421614" => Ok(Chain::ArbitrumSepolia),
            "11155420" => Ok(Chain::OptimismSepolia),
            "97" => Ok(Chain::BscTestnet),
            "57054" => Ok(Chain::SonicBlaze),
            "14601" => Ok(Chain::SonicTestnet),
            "534351" => Ok(Chain::ScrollSepolia),
            "10200" => Ok(Chain::GnosisChiado),
            "43113" => Ok(Chain::AvalancheFuji),
            "33111" => Ok(Chain::ApechainCurtis),
            "267" => Ok(Chain::NeuraTestnet),
            "1328" => Ok(Chain::SeiTestnet),
            "1301" => Ok(Chain::UnichainTestnet),
            "4801" => Ok(Chain::WorldchainTestnet),
            "20993" => Ok(Chain::FluentTestnet),
            "5042002" => Ok(Chain::ArcTestnet),
            "43113" => Ok(Chain::AvaxTestnet),
            "6342" => Ok(Chain::MegaethTestnet),
            "222888" => Ok(Chain::MocaTestnet),
            _ => Err(eyre::eyre!("Invalid chain id")),
        }
    }
}

impl std::fmt::Display for Chain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        format!("{:?}", self).fmt(f)
    }
}
