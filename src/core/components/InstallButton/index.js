/* @flow */
/* global InstallTrigger, window */
import makeClassName from 'classnames';
import { oneLine } from 'common-tags';
import config from 'config';
import * as React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';

import { getAddonIconUrl } from 'core/imageUtils';
import {
  ADDON_TYPE_OPENSEARCH,
  ADDON_TYPE_THEME,
  ADDON_TYPE_THEMES,
  DISABLED,
  DOWNLOADING,
  ENABLED,
  ENABLING,
  INSTALLED,
  INSTALLING,
  INSTALL_ACTION,
  INSTALL_STARTED_ACTION,
  UNINSTALLING,
} from 'core/constants';
import translate from 'core/i18n/translate';
import { findInstallURL } from 'core/installAddon';
import log from 'core/logger';
import { getThemeData } from 'core/themeInstall';
import tracking, {
  getAddonTypeForTracking,
  getAddonEventCategory,
} from 'core/tracking';
import { getClientCompatibility } from 'core/utils/compatibility';
import AnimatedIcon from 'ui/components/AnimatedIcon';
import Button from 'ui/components/Button';
import Icon from 'ui/components/Icon';
import type { AppState } from 'amo/store';
import type { AddonType } from 'core/types/addons';
import type { I18nType } from 'core/types/i18n';
import type { ReactRouterLocation } from 'core/types/router';

import './styles.scss';

type Props = {|
  addon: AddonType,
  className?: string,
  defaultInstallSource: string,
  disabled: boolean,
  location: ReactRouterLocation,
  status: string,
  // From `withInstallHelpers()`, see: `src/core/installAddon.js`.
  enable: Function,
  install: Function,
  installTheme: Function,
  uninstall: Function,
|};

type InternalProps = {|
  ...Props,
  _InstallTrigger: typeof InstallTrigger,
  _config: typeof config,
  _getClientCompatibility: Function,
  _log: typeof log,
  _tracking: typeof tracking,
  _window: typeof window,
  clientApp: string,
  i18n: I18nType,
  userAgentInfo: string,
|};

type TrackParams = {|
  addonName: string,
  type: string,
|};

type ButtonProps = {|
  buttonType: string,
  'data-browsertheme'?: string,
  href: string,
  onClick: Function,
  prependClientApp?: boolean,
  prependLang?: boolean,
|};

type GetFileHashParams = {|
  addon: AddonType,
  installURL: string,
|};

export const getFileHash = ({ addon, installURL }: GetFileHashParams = {}):
  | string
  | typeof undefined => {
  if (!addon) {
    throw new Error('The addon parameter cannot be empty');
  }
  if (!installURL) {
    throw new Error('The installURL parameter cannot be empty');
  }

  const urlKey = installURL.split('?')[0];

  // TODO: refactor createInternalAddon() to expose file objects
  // per platform so we don't have to do this.
  // https://github.com/mozilla/addons-frontend/issues/3871

  if (addon.current_version) {
    for (const file of addon.current_version.files) {
      // The API sometimes appends ?src= to URLs so we just check the
      // basename.
      if (file.url.startsWith(urlKey)) {
        return file.hash;
      }
    }
  }

  log.warn(oneLine`No file hash found for addon "${addon.slug}",
    installURL "${installURL}" (as "${urlKey}")`);

  return undefined;
};

export class InstallButtonBase extends React.Component<InternalProps> {
  static defaultProps = {
    _InstallTrigger:
      typeof InstallTrigger !== 'undefined' ? InstallTrigger : null,
    _config: config,
    _getClientCompatibility: getClientCompatibility,
    _log: log,
    _tracking: tracking,
    _window: typeof window !== 'undefined' ? window : {},
  };

  installTheme = (event: SyntheticEvent<HTMLAnchorElement>) => {
    const { addon, status, installTheme } = this.props;

    event.preventDefault();
    event.stopPropagation();

    installTheme(event.currentTarget, { ...addon, status });
  };

  installOpenSearch = (event: SyntheticEvent<HTMLAnchorElement>) => {
    const { _log, _window, addon } = this.props;

    event.preventDefault();
    event.stopPropagation();

    const installURL = event.currentTarget.href;

    _log.info('Adding OpenSearch Provider', { addon });
    _window.external.AddSearchProvider(installURL);

    this.trackInstallStarted({
      addonName: addon.name,
      type: addon.type,
    });

    return false;
  };

  installExtension = (event: SyntheticEvent<HTMLAnchorElement>) => {
    const { _InstallTrigger, addon } = this.props;
    const { name, type } = addon;

    this.trackInstallStarted({ addonName: name, type });

    if (!_InstallTrigger) {
      // Let the button serve the file like a normal link.
      return true;
    }

    log.debug(`Installing addon "${addon.slug}" with InstallTrigger`);

    event.preventDefault();
    event.stopPropagation();

    const installURL = event.currentTarget.href;

    // This is a Firefox API for installing extensions that
    // pre-dates mozAddonManager.
    //
    // See
    // https://developer.mozilla.org/en-US/docs/Web/API/InstallTrigger/install
    // https://github.com/mozilla/addons-server/blob/98c97f3ebce7f82b8c32f271df3034eae3245f1f/static/js/zamboni/buttons.js#L310
    //
    _InstallTrigger.install(
      {
        [name]: {
          Hash: getFileHash({ addon, installURL }),
          IconURL: getAddonIconUrl(addon),
          URL: installURL,
          // The old AMO did this so, hey, why not?
          toString: () => installURL,
        },
      },
      (xpiURL, status) => {
        log.debug(oneLine`InstallTrigger completed for "${xpiURL}";
        status=${status}`);

        if (status === 0) {
          // The extension was installed successfully.
          this.trackInstallSucceeded({
            addonName: name,
            type,
          });
        }
      },
    );

    return false;
  };

  uninstallAddon = (event: SyntheticEvent<HTMLAnchorElement>) => {
    const { addon, uninstall } = this.props;
    const { guid, name, type } = addon;

    event.preventDefault();
    event.stopPropagation();

    const installURL = event.currentTarget.href;

    uninstall({ guid, installURL, name, type });

    return false;
  };

  trackInstallStarted({ addonName, type }: TrackParams) {
    const { _tracking } = this.props;

    _tracking.sendEvent({
      action: getAddonTypeForTracking(type),
      category: getAddonEventCategory(type, INSTALL_STARTED_ACTION),
      label: addonName,
    });
  }

  trackInstallSucceeded({ addonName, type }: TrackParams) {
    const { _tracking } = this.props;

    _tracking.sendEvent({
      action: getAddonTypeForTracking(type),
      category: getAddonEventCategory(type, INSTALL_ACTION),
      label: addonName,
    });
  }

  showLoadingAnimation() {
    return [DOWNLOADING, ENABLING, INSTALLING, UNINSTALLING].includes(
      this.props.status,
    );
  }

  getButtonText() {
    const { addon, i18n, status } = this.props;

    switch (status) {
      case DISABLED:
      case ENABLED:
      case INSTALLED:
        return i18n.gettext('Remove');
      case ENABLING:
        return i18n.gettext('Enabling');
      case DOWNLOADING:
        return i18n.gettext('Downloading');
      case INSTALLING:
        return i18n.gettext('Installing');
      case UNINSTALLING:
        return i18n.gettext('Uninstalling');
      default:
        return ADDON_TYPE_THEMES.includes(addon.type)
          ? i18n.gettext('Install Theme')
          : i18n.gettext('Add to Firefox');
    }
  }

  getIconName() {
    const { status } = this.props;

    switch (status) {
      case DISABLED:
      case ENABLED:
      case INSTALLED:
        return 'delete';
      default:
        return 'plus';
    }
  }

  render() {
    const {
      _config,
      _getClientCompatibility,
      _log,
      addon,
      className,
      clientApp,
      defaultInstallSource,
      location,
      status,
      userAgentInfo,
    } = this.props;

    if (addon.type === ADDON_TYPE_OPENSEARCH && _config.get('server')) {
      _log.info('Not rendering opensearch install button on the server');
      return null;
    }

    const { compatible } = _getClientCompatibility({
      addon,
      clientApp,
      userAgentInfo,
    });

    const buttonIsDisabled = !compatible;
    const buttonClass = makeClassName('InstallButton-button', className, {
      'InstallButton-button--disabled': buttonIsDisabled,
    });

    const installURL = findInstallURL({
      defaultInstallSource,
      location,
      platformFiles: addon.platformFiles,
      userAgentInfo,
    });

    const buttonProps: ButtonProps = {
      buttonType: 'action',
      href: installURL,
      onClick: (event) => event.preventDefault(),
    };

    if (!buttonIsDisabled) {
      if ([DISABLED, ENABLED, INSTALLED].includes(status)) {
        buttonProps.buttonType = 'neutral';
        buttonProps.onClick = this.uninstallAddon;
      } else if (addon.type === ADDON_TYPE_THEME) {
        buttonProps['data-browsertheme'] = JSON.stringify(getThemeData(addon));
        buttonProps.onClick = this.installTheme;
      } else {
        buttonProps.onClick =
          addon.type === ADDON_TYPE_OPENSEARCH
            ? this.installOpenSearch
            : this.installExtension;
        buttonProps.prependClientApp = false;
        buttonProps.prependLang = false;
      }
    }

    return (
      <div className="InstallButton">
        {this.showLoadingAnimation() ? (
          <div className="InstallButton-loading">
            <AnimatedIcon alt={this.getButtonText()} name="loading" />
          </div>
        ) : (
          <Button className={buttonClass} {...buttonProps}>
            <Icon name={this.getIconName()} />
            {this.getButtonText()}
          </Button>
        )}
      </div>
    );
  }
}

export function mapStateToProps(state: AppState) {
  return {
    clientApp: state.api.clientApp,
    userAgentInfo: state.api.userAgentInfo,
  };
}

const InstallButton: React.ComponentType<Props> = compose(
  withRouter,
  connect(mapStateToProps),
  translate(),
)(InstallButtonBase);

export default InstallButton;
