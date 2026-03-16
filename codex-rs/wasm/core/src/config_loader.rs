use std::ops::Deref;

use codex_app_server_protocol::ConfigLayerSource;
use codex_utils_absolute_path::AbsolutePathBuf;
use toml::Value as TomlValue;

#[derive(Clone, Debug, PartialEq)]
pub struct ConfigLayerStack {
    layers: Vec<ConfigLayerEntry>,
    requirements: NetworkRequirementsView,
    requirements_toml: ConfigRequirementsToml,
    effective_config: toml::Value,
}

impl Default for ConfigLayerStack {
    fn default() -> Self {
        Self {
            layers: Vec::new(),
            requirements: NetworkRequirementsView::default(),
            requirements_toml: ConfigRequirementsToml,
            effective_config: toml::Value::Table(Default::default()),
        }
    }
}

#[derive(Clone, Debug)]
pub enum ConfigLayerStackOrdering {
    LowestPrecedenceFirst,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub enum RequirementSource {
    #[default]
    Unknown,
    CloudRequirements,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sourced<T>(pub T);

#[derive(Clone, Debug, PartialEq)]
pub struct ConfigLayerEntry {
    pub source: ConfigLayerSource,
    pub config: TomlValue,
}

pub type ConfigRequirements = NetworkRequirementsView;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ConfigRequirementsToml;

impl ConfigLayerStack {
    pub fn new(
        layers: Vec<ConfigLayerEntry>,
        requirements: NetworkRequirementsView,
        requirements_toml: ConfigRequirementsToml,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            layers,
            requirements,
            requirements_toml,
            effective_config: toml::Value::Table(Default::default()),
        })
    }

    pub fn get_layers(
        &self,
        _ordering: ConfigLayerStackOrdering,
        _include_profiles: bool,
    ) -> Vec<&ConfigLayerEntry> {
        self.layers.iter().collect()
    }

    pub fn requirements(&self) -> NetworkRequirementsView {
        self.requirements.clone()
    }

    pub fn requirements_toml(&self) -> &ConfigRequirementsToml {
        &self.requirements_toml
    }

    pub fn effective_config(&self) -> toml::Value {
        self.effective_config.clone()
    }

    pub fn with_user_config<P: AsRef<std::path::Path>>(
        mut self,
        path: P,
        user_config: toml::Value,
    ) -> Self {
        let path = path.as_ref();
        if let Ok(path) = AbsolutePathBuf::from_absolute_path(path) {
            let source = ConfigLayerSource::User { file: path };
            let entry = ConfigLayerEntry::new(source.clone(), user_config.clone());
            if let Some(existing) = self.layers.iter_mut().find(|layer| layer.source == source) {
                *existing = entry;
            } else {
                self.layers.push(entry);
            }
        }
        self.effective_config = user_config;
        self
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NetworkRequirementsView {
    pub network: Option<Sourced<NetworkConstraints>>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NetworkConstraints {
    pub allowed_domains: Option<Vec<String>>,
    pub denied_domains: Option<Vec<String>>,
}

impl<T> Sourced<T> {
    pub fn new(value: T, _source: RequirementSource) -> Self {
        Self(value)
    }
}

impl<T> Deref for Sourced<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl ConfigLayerEntry {
    pub fn new(source: ConfigLayerSource, config: TomlValue) -> Self {
        Self { source, config }
    }

    pub fn config_folder(&self) -> Option<AbsolutePathBuf> {
        match &self.source {
            ConfigLayerSource::Project { dot_codex_folder } => Some(dot_codex_folder.clone()),
            ConfigLayerSource::User { file }
            | ConfigLayerSource::System { file }
            | ConfigLayerSource::LegacyManagedConfigTomlFromFile { file } => file
                .as_path()
                .parent()
                .and_then(|parent| AbsolutePathBuf::from_absolute_path(parent).ok()),
            ConfigLayerSource::SessionFlags
            | ConfigLayerSource::LegacyManagedConfigTomlFromMdm
            | ConfigLayerSource::Mdm { .. } => None,
        }
    }
}
