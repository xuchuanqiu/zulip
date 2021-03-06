var activity = (function () {
var exports = {};

/*
    Helpers for detecting user activity and managing user idle states
*/

/* Broadcast "idle" to server after 5 minutes of local inactivity */
var DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/* Time between keep-alive pings */
var ACTIVE_PING_INTERVAL_MS = 50 * 1000;

/* Keep in sync with views.py:update_active_status_backend() */
exports.ACTIVE = "active";
exports.IDLE = "idle";

var meta = {};

// When you start Zulip, has_focus should be true, but it might not be the
// case after a server-initiated reload.
exports.has_focus = document.hasFocus && document.hasFocus();

// We initialize this to true, to count new page loads, but set it to
// false in the onload function in reload.js if this was a
// server-initiated-reload to avoid counting a server-initiated reload
// as user activity.
exports.new_user_input = true;

var huddle_timestamps = new Dict();

exports.update_scrollbar = (function () {
    var $user_presences = $("#user_presences");
    var $group_pms = $("#group-pms");

    return {
        users: function () {
            if (!$user_presences.length) {
                $user_presences = $("#user_presences");
            }
            ui.update_scrollbar($user_presences);
        },
        group_pms: function () {
            if (!$group_pms.length) {
                $group_pms = $("#group-pms");
            }
            ui.update_scrollbar($group_pms);
        },
    };
}());

function update_pm_count_in_dom(count_span, value_span, count) {
    var li = count_span.parent();

    if (count === 0) {
        count_span.hide();
        li.removeClass("user-with-count");
        value_span.text('');
        return;
    }

    count_span.show();
    li.addClass("user-with-count");
    value_span.text(count);
}

function update_group_count_in_dom(count_span, value_span, count) {
    var li = count_span.parent();

    if (count === 0) {
        count_span.hide();
        li.removeClass("group-with-count");
        value_span.text('');
        return;
    }

    count_span.show();
    li.addClass("group-with-count");
    value_span.text(count);
}

function get_pm_list_item(user_id) {
    return buddy_list.find_li({
        key: user_id,
    });
}

function get_group_list_item(user_ids_string) {
    return $("li.group-pms-sidebar-entry[data-user-ids='" + user_ids_string + "']");
}

function set_pm_count(user_ids_string, count) {
    var count_span = get_pm_list_item(user_ids_string).find('.count');
    var value_span = count_span.find('.value');
    update_pm_count_in_dom(count_span, value_span, count);
}

function set_group_count(user_ids_string, count) {
    var count_span = get_group_list_item(user_ids_string).find('.count');
    var value_span = count_span.find('.value');
    update_group_count_in_dom(count_span, value_span, count);
}

exports.update_dom_with_unread_counts = function (counts) {
    // counts is just a data object that gets calculated elsewhere
    // Our job is to update some DOM elements.

    counts.pm_count.each(function (count, user_ids_string) {
        // TODO: just use user_ids_string in our markup
        var is_pm = user_ids_string.indexOf(',') < 0;
        if (is_pm) {
            set_pm_count(user_ids_string, count);
        } else {
            set_group_count(user_ids_string, count);
        }
    });
};

exports.process_loaded_messages = function (messages) {
    var need_resize = false;

    _.each(messages, function (message) {
        var huddle_string = people.huddle_string(message);

        if (huddle_string) {
            var old_timestamp = huddle_timestamps.get(huddle_string);

            if (!old_timestamp || (old_timestamp < message.timestamp)) {
                huddle_timestamps.set(huddle_string, message.timestamp);
                need_resize = true;
            }
        }
    });

    exports.update_huddles();

    if (need_resize) {
        resize.resize_page_components(); // big hammer
    }
};

exports.get_huddles = function () {
    var huddles = huddle_timestamps.keys();
    huddles = _.sortBy(huddles, function (huddle) {
        return huddle_timestamps.get(huddle);
    });
    return huddles.reverse();
};

exports.full_huddle_name = function (huddle) {
    var user_ids = huddle.split(',');

    var names = _.map(user_ids, function (user_id) {
        var person = people.get_person_from_user_id(user_id);
        return person.full_name;
    });

    return names.join(', ');
};

exports.short_huddle_name = function (huddle) {
    var user_ids = huddle.split(',');

    var num_to_show = 3;
    var names = _.map(user_ids, function (user_id) {
        var person = people.get_person_from_user_id(user_id);
        return person.full_name;
    });

    names = _.sortBy(names, function (name) { return name.toLowerCase(); });
    names = names.slice(0, num_to_show);
    var others = user_ids.length - num_to_show;

    if (others === 1) {
        names.push("+ 1 other");
    } else if (others >= 2) {
        names.push("+ " + others + " others");
    }

    return names.join(', ');
};

exports.huddle_fraction_present = function (huddle) {
    var user_ids = huddle.split(',');

    var num_present = 0;
    _.each(user_ids, function (user_id) {
        if (presence.is_not_offline(user_id)) {
            num_present += 1;
        }
    });

    var ratio = num_present / user_ids.length;

    return ratio.toFixed(2);
};

function focus_lost() {
    // When we become idle, we don't immediately send anything to the
    // server; instead, we wait for our next periodic update, since
    // this data is fundamentally not timely.
    exports.has_focus = false;
}

exports.insert_user_into_list = function (user_id) {
    if (page_params.realm_presence_disabled) {
        return;
    }

    var filter_text = exports.get_filter_text();

    if (!buddy_data.matches_filter(filter_text, user_id)) {
        return;
    }

    var info = buddy_data.info_for(user_id);

    buddy_list.insert_or_move({
        key: user_id,
        item: info,
        compare_function: buddy_data.compare_function,
    });

    exports.update_scrollbar.users();

    var elt = get_pm_list_item(user_id);
    compose_fade.update_one_user_row(elt);
};

exports.build_user_sidebar = function () {
    if (page_params.realm_presence_disabled) {
        return;
    }

    var filter_text = exports.get_filter_text();

    var user_info = buddy_data.get_items(filter_text);

    buddy_list.populate({
        items: user_info,
    });

    // Update user fading, if necessary.
    compose_fade.update_faded_users();

    resize.resize_page_components();

    // Highlight top user when searching
    $('#user_presences li.user_sidebar_entry.highlighted_user').removeClass('highlighted_user');
    if (exports.searching()) {
        var all_streams = $('#user_presences li.user_sidebar_entry.narrow-filter');
        stream_list.highlight_first(all_streams, 'highlighted_user');
    }
    return user_info; // for testing
};

var update_users_for_search = _.throttle(exports.build_user_sidebar, 50);

function show_huddles() {
    $('#group-pm-list').addClass("show");
}

function hide_huddles() {
    $('#group-pm-list').removeClass("show");
}

exports.update_huddles = function () {
    if (page_params.realm_presence_disabled) {
        return;
    }

    var huddles = exports.get_huddles().slice(0, 10);

    if (huddles.length === 0) {
        hide_huddles();
        return;
    }

    var group_pms = _.map(huddles, function (huddle) {
        return {
            user_ids_string: huddle,
            name: exports.full_huddle_name(huddle),
            href: narrow.huddle_with_uri(huddle),
            fraction_present: exports.huddle_fraction_present(huddle),
            short_name: exports.short_huddle_name(huddle),
        };
    });

    var html = templates.render('group_pms', {group_pms: group_pms});
    $('#group-pms').expectOne().html(html);

    _.each(huddles, function (user_ids_string) {
        var count = unread.num_unread_for_person(user_ids_string);
        set_group_count(user_ids_string, count);
    });

    show_huddles();
    exports.update_scrollbar.group_pms();
};

function focus_ping(want_redraw) {
    if (reload.is_in_progress()) {
        blueslip.log("Skipping querying presence because reload in progress");
        return;
    }
    channel.post({
        url: '/json/users/me/presence',
        data: {status: (exports.has_focus) ? exports.ACTIVE : exports.IDLE,
               ping_only: !want_redraw,
               new_user_input: exports.new_user_input},
        idempotent: true,
        success: function (data) {

            // Update Zephyr mirror activity warning
            if (data.zephyr_mirror_active === false) {
                $('#zephyr-mirror-error').addClass("show");
            } else {
                $('#zephyr-mirror-error').removeClass("show");
            }

            exports.new_user_input = false;

            // Zulip has 2 data feeds coming from the server to the
            // client: The server_events data, and this presence feed.
            // Everything in server_events is nicely serialized, but
            // if we've been offline and not running for a while
            // (e.g. due to suspend), we can end up throwing
            // exceptions due to users appearing in presence that we
            // haven't learned about yet.  We handle this in 2 stages.
            // First, here, we make sure that we've confirmed whether
            // we are indeed in the unsuspend case.  Then, in
            // `presence.set_info`, we only complain about unknown
            // users if server_events does not suspect we're offline.
            server_events.check_for_unsuspend();

            if (want_redraw) {
                presence.set_info(data.presences, data.server_timestamp);
                exports.build_user_sidebar();
                exports.update_huddles();
            }
        },
    });
}

function focus_gained() {
    if (!exports.has_focus) {
        exports.has_focus = true;
        focus_ping(false);
    }
}

exports.initialize = function () {
    $("html").on("mousemove", function () {
        exports.new_user_input = true;
    });

    $(window).focus(focus_gained);
    $(window).idle({idle: DEFAULT_IDLE_TIMEOUT_MS,
                onIdle: focus_lost,
                onActive: focus_gained,
                keepTracking: true});

    presence.set_info(page_params.presences,
                      page_params.initial_servertime);
    delete page_params.presences;

    exports.set_user_list_filter();

    exports.build_user_sidebar();
    exports.update_huddles();

    exports.set_user_list_filter_handlers();

    $('#clear_search_people_button').on('click', exports.clear_search);
    $('#userlist-header').click(exports.toggle_filter_displayed);

    // Let the server know we're here, but pass "false" for
    // want_redraw, since we just got all this info in page_params.
    focus_ping(false);

    function get_full_presence_list_update() {
        focus_ping(true);
    }

    setInterval(get_full_presence_list_update, ACTIVE_PING_INTERVAL_MS);

    ui.set_up_scrollbar($("#user_presences"));
    ui.set_up_scrollbar($("#group-pms"));
};

exports.set_user_status = function (email, info, server_time) {
    if (people.is_current_user(email)) {
        return;
    }

    var user_id = people.get_user_id(email);
    if (!user_id) {
        blueslip.warn('unknown email: ' + email);
        return;
    }

    presence.set_user_status(user_id, info, server_time);
    exports.insert_user_into_list(user_id);
    exports.update_huddles();
};

exports.redraw = function () {
    exports.build_user_sidebar();
    exports.update_huddles();
};

exports.searching = function () {
    return $('.user-list-filter').expectOne().is(':focus');
};

exports.clear_search = function () {
    var filter = $('.user-list-filter').expectOne();
    if (filter.val() === '') {
        exports.clear_and_hide_search();
        return;
    }
    filter.val('');
    filter.blur();
    update_users_for_search();
};

exports.escape_search = function () {
    var filter = $('.user-list-filter').expectOne();
    if (filter.val() === '') {
        exports.clear_and_hide_search();
        return;
    }
    filter.val('');
    update_users_for_search();
};

exports.clear_and_hide_search = function () {
    var filter = $('.user-list-filter').expectOne();
    if (filter.val() !== '') {
        filter.val('');
        update_users_for_search();
    }
    filter.blur();
    $('#user-list .input-append').addClass('notdisplayed');
    // Undo highlighting
    $('#user_presences li.user_sidebar_entry.highlighted_user').removeClass('highlighted_user');
};

function highlight_first_user() {
    if ($('#user_presences li.user_sidebar_entry.narrow-filter.highlighted_user').length === 0) {
        // Highlight
        var all_streams = $('#user_presences li.user_sidebar_entry.narrow-filter');
        stream_list.highlight_first(all_streams, 'highlighted_user');
    }
}

exports.initiate_search = function () {
    var filter = $('.user-list-filter').expectOne();
    var column = $('.user-list-filter').closest(".app-main [class^='column-']");
    $('#user-list .input-append').removeClass('notdisplayed');
    if (!column.hasClass("expanded")) {
        popovers.hide_all();
        if (column.hasClass('column-left')) {
            stream_popover.show_streamlist_sidebar();
        } else if (column.hasClass('column-right')) {
            popovers.show_userlist_sidebar();
        }
    }
    filter.focus();
    highlight_first_user();
};

exports.toggle_filter_displayed = function () {
    if ($('#user-list .input-append').hasClass('notdisplayed')) {
        exports.initiate_search();
    } else {
        exports.clear_and_hide_search();
    }
};

exports.narrow_for_user = function (opts) {
    var user_id = buddy_list.get_key_from_li({li: opts.li});
    var email = people.get_person_from_user_id(user_id).email;

    narrow.by('pm-with', email, {trigger: 'sidebar'});
    exports.clear_and_hide_search();
};

function keydown_enter_key() {
    // Is there at least one user?
    if ($('#user_presences li.user_sidebar_entry.narrow-filter').length > 0) {
        // There must be a 'highlighted_user' user
        var li = $('#user_presences li.user_sidebar_entry.narrow-filter.highlighted_user');
        exports.narrow_for_user({li: li});
        popovers.hide_all();
    }
}

function keydown_user_filter(e) {
    stream_list.keydown_filter(e, '#user_presences li.user_sidebar_entry.narrow-filter',
                               $('#user_presences'), 'highlighted_user', keydown_enter_key);
}

function focus_user_filter(e) {
    highlight_first_user();
    e.stopPropagation();
}

function focusout_user_filter() {
    // Undo highlighting
    $('#user_presences li.user_sidebar_entry.highlighted_user').removeClass('highlighted_user');
}

exports.set_user_list_filter = function () {
    meta.$user_list_filter = $(".user-list-filter");
};

exports.set_user_list_filter_handlers = function () {
    meta.$user_list_filter.expectOne()
        .on('click', focus_user_filter)
        .on('input', update_users_for_search)
        .on('keydown', keydown_user_filter)
        .on('blur', focusout_user_filter);
};

exports.get_filter_text = function () {
    if (!meta.$user_list_filter) {
        // This may be overly defensive, but there may be
        // situations where get called before everything is
        // fully initialized.  The empty string is a fine
        // default here.
        blueslip.warn('get_filter_text() is called before initialization');
        return '';
    }

    var user_filter = meta.$user_list_filter.expectOne().val().trim();

    return user_filter;
};

return exports;

}());
if (typeof module !== 'undefined') {
    module.exports = activity;
}
